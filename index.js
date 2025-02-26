const fs = require('fs');
const { ethers } = require('ethers');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
require('dotenv').config();

const VOTING_CONTRACT_ADDRESS = '0x672e69f8ED6eA070f5722d6c77940114cc901938';
const FAUCET_CONTRACT_ADDRESS = '0x43808E0766f88332535FF8326F52e4734de35F0e';
const VOTING_TOKEN_ADDRESS = '0x3E933b66904F83b6E91a9511877C99b43584adA3';

const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
const CHAIN_ID = 84532;

function readPrivateKeys() {
    try {
        const data = fs.readFileSync('pk.txt', 'utf8');
        return data.split('\n').map(key => key.trim()).filter(key => key);
    } catch (error) {
        console.error('Error reading private keys:', error.message);
        return [];
    }
}

function readProxies() {
    try {
        const data = fs.readFileSync('proxies.txt', 'utf8');
        return data.split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);
    } catch (error) {
        console.error('Error reading proxies:', error.message);
        return [];
    }
}

const votingContractABI = [
    {
        "inputs": [
            {"internalType": "bytes32[]", "name": "votingProjectIds", "type": "bytes32[]"},
            {"internalType": "uint256[]", "name": "votes", "type": "uint256[]"}
        ],
        "name": "voteOnProjects",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

const faucetContractABI = [
    {
        "inputs": [
            {"internalType": "address[]", "name": "tokenAddresses", "type": "address[]"}
        ],
        "name": "claimTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

const erc20ABI = [
    {
        "constant": true,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "value", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "owner", "type": "address"},
            {"internalType": "address", "name": "spender", "type": "address"}
        ],
        "name": "allowance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
];

const projectIdsToVote = [
    "0xe5d033db611ae3f5682ace7285860a6ceb1195d5f80f2721a82d4baff67daddb",
    "0xb99bb4429ce45c2cf000bc98f847741c88603e234f6099d78fe47c2b50738776",
    "0x8689005e34728a5f6027d7c12bd49ef51fa54d62971bf6e5490fbaaaf85a1e21",
    "0xf712336c9a04915c7b25b30412d0fb8613a417cd8a94f00ca0b2da73e1704949"
];

const voteDistributions = [
    "4000000000000000000",
    "2000000000000000000",
    "2000000000000000000",
    "2000000000000000000"
];

const totalVoteAmount = voteDistributions.reduce((total, amount) => {
    return ethers.toBigInt(total) + ethers.toBigInt(amount);
}, ethers.toBigInt(0));

const tokensToClaimFrom = [
    "0xEa347A7CB535cBE125099A4C3B992149aE08e55d",
    "0xB9e5D51908CCF86d91443e61a4C9d8e4FeE27e33",
    "0x3E933b66904F83b6E91a9511877C99b43584adA3"
];

function getProxyAgent(proxy) {
    if (!proxy) return null;

    const proxyRegex = /^(?:(http|socks4|socks5):\/\/)?(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i;
    const match = proxy.match(proxyRegex);

    let protocol, username, password, ip, port;
    if (match) {
        protocol = (match[1] || 'http').toLowerCase(); 
        username = match[2];
        password = match[3];
        ip = match[4];
        port = match[5];
    } else {
        const simpleFormat = proxy.split(':');
        if (simpleFormat.length >= 2) {
            protocol = 'http'; 
            ip = simpleFormat[0];
            port = simpleFormat[1];
            if (simpleFormat.length > 2) {
                protocol = simpleFormat[0].toLowerCase();
                ip = simpleFormat[1];
                port = simpleFormat[2];
            }
        } else {
            throw new Error(`Invalid proxy format: ${proxy}`);
        }
    }

    const proxyUrl = username && password ? `${protocol}://${username}:${password}@${ip}:${port}` : `${protocol}://${ip}:${port}`;

    if (protocol === 'http') {
        return new HttpsProxyAgent(proxyUrl);
    } else if (protocol === 'socks4' || protocol === 'socks5') {
        return new SocksProxyAgent(proxyUrl);
    } else {
        throw new Error(`Unsupported proxy protocol: ${protocol}`);
    }
}

function createProviderWithProxy(proxy) {
    const fetchRequest = new ethers.FetchRequest(RPC_URL);
    const agent = getProxyAgent(proxy);

    if (agent) {
        fetchRequest.agent = agent; 
    }

    return new ethers.JsonRpcProvider(fetchRequest);
}

async function approveTokensForVoting(wallet, proxy) {
    try {
        const provider = createProviderWithProxy(proxy);
        const signer = new ethers.Wallet(wallet, provider);
        const tokenContract = new ethers.Contract(VOTING_TOKEN_ADDRESS, erc20ABI, signer);

        console.log(`Checking allowance for address: ${signer.address}`);
        const currentAllowance = await tokenContract.allowance(signer.address, VOTING_CONTRACT_ADDRESS);
        console.log(`Current allowance: ${ethers.formatEther(currentAllowance)} tokens`);

        if (currentAllowance >= totalVoteAmount) {
            console.log(`Sufficient allowance already exists. No need to approve.`);
            return true;
        }

        const gasLimit = 100000;
        console.log(`Approving ${ethers.formatEther(totalVoteAmount)} tokens for voting contract...`);
        const approveAmount = totalVoteAmount * BigInt(2);
        const tx = await tokenContract.approve(VOTING_CONTRACT_ADDRESS, approveAmount, { gasLimit });

        console.log(`Approval transaction submitted: ${tx.hash}`);
        console.log(`View transaction: https://base-sepolia.blockscout.com/tx/${tx.hash}`);
        const receipt = await tx.wait();
        if (receipt.status === 0) {
            console.error('Approval transaction failed!');
            return false;
        }

        console.log(`Approval transaction confirmed! Gas used: ${receipt.gasUsed}`);
        const newAllowance = await tokenContract.allowance(signer.address, VOTING_CONTRACT_ADDRESS);
        console.log(`New allowance: ${ethers.formatEther(newAllowance)} tokens`);
        return true;
    } catch (error) {
        console.error(`Error approving tokens: ${error.message}`);
        if (error.transaction) console.log('Transaction data:', error.transaction);
        if (error.receipt) console.log('Receipt:', error.receipt);
        return false;
    }
}

async function voteOnProjects(wallet, proxy) {
    try {
        const provider = createProviderWithProxy(proxy);
        const signer = new ethers.Wallet(wallet, provider);
        const contract = new ethers.Contract(VOTING_CONTRACT_ADDRESS, votingContractABI, signer);

        console.log(`Voting on projects from address: ${signer.address}`);
        console.log('Voting with the following distribution:');
        for (let i = 0; i < projectIdsToVote.length; i++) {
            console.log(`Project ${i+1}: ${projectIdsToVote[i]} - ${ethers.formatEther(voteDistributions[i])} tokens`);
        }

        const code = await provider.getCode(VOTING_CONTRACT_ADDRESS);
        if (code === '0x') {
            console.error('Voting contract does not exist at the specified address!');
            return false;
        }

        const approvalSuccess = await approveTokensForVoting(wallet, proxy);
        if (!approvalSuccess) {
            console.error('Failed to approve tokens for voting. Aborting vote.');
            return false;
        }

        const gasLimit = 3000000;
        console.log(`Using fixed gas limit for voting: ${gasLimit}`);
        const tx = await contract.voteOnProjects(projectIdsToVote, voteDistributions, { gasLimit });

        console.log(`Vote transaction submitted: ${tx.hash}`);
        console.log(`View transaction: https://base-sepolia.blockscout.com/tx/${tx.hash}`);
        const receipt = await tx.wait();
        if (receipt.status === 0) {
            console.error('Vote transaction failed!');
            return false;
        }

        console.log(`Vote transaction confirmed! Gas used: ${receipt.gasUsed}`);
        return true;
    } catch (error) {
        console.error(`Error voting on projects: ${error.message}`);
        if (error.message.includes('insufficient allowance') || error.message.includes('allowance') || error.data?.includes('allowance')) {
            console.log('This appears to be an allowance error. Trying to approve again with higher amount...');
            const provider = createProviderWithProxy(proxy);
            const signer = new ethers.Wallet(wallet, provider);
            const tokenContract = new ethers.Contract(VOTING_TOKEN_ADDRESS, erc20ABI, signer);
            const largerAmount = ethers.parseEther("1000");
            try {
                const approveTx = await tokenContract.approve(VOTING_CONTRACT_ADDRESS, largerAmount, { gasLimit: 100000 });
                console.log(`Emergency approval transaction submitted: ${approveTx.hash}`);
                await approveTx.wait();
                console.log('Emergency approval successful. Please try voting again.');
            } catch (approveError) {
                console.error(`Emergency approval failed: ${approveError.message}`);
            }
        }
        if (error.transaction) console.log('Transaction data:', error.transaction);
        if (error.receipt) console.log('Receipt:', error.receipt);
        return false;
    }
}

async function claimTokens(wallet, proxy) {
    try {
        const provider = createProviderWithProxy(proxy);
        const signer = new ethers.Wallet(wallet, provider);
        const contract = new ethers.Contract(FAUCET_CONTRACT_ADDRESS, faucetContractABI, signer);

        console.log(`Claiming tokens from address: ${signer.address}`);
        console.log('Claiming from token addresses:');
        tokensToClaimFrom.forEach(token => console.log(`- ${token}`));

        const code = await provider.getCode(FAUCET_CONTRACT_ADDRESS);
        if (code === '0x') {
            console.error('Faucet contract does not exist at the specified address!');
            return false;
        }

        const gasLimit = 250000;
        console.log(`Using fixed gas limit for claiming: ${gasLimit}`);
        const tx = await contract.claimTokens(tokensToClaimFrom, { gasLimit });

        console.log(`Claim transaction submitted: ${tx.hash}`);
        console.log(`View transaction: https://base-sepolia.blockscout.com/tx/${tx.hash}`);
        const receipt = await tx.wait();
        if (receipt.status === 0) {
            console.error('Claim transaction failed!');
            return false;
        }

        console.log(`Claim transaction confirmed! Gas used: ${receipt.gasUsed}`);
        return true;
    } catch (error) {
        console.error(`Error claiming tokens: ${error.message}`);
        if (error.message.includes('already claimed') || error.message.includes('time limit')) {
            console.log('Tokens may have been claimed recently. There might be a time limit between claims.');
        }
        if (error.transaction) console.log('Transaction data:', error.transaction);
        if (error.receipt) console.log('Receipt:', error.receipt);
        return false;
    }
}

async function checkBalance(wallet, proxy) {
    try {
        const provider = createProviderWithProxy(proxy);
        const balance = await provider.getBalance(new ethers.Wallet(wallet).address);
        return ethers.formatEther(balance);
    } catch (error) {
        console.error(`Error checking balance: ${error.message}`);
        return '0';
    }
}

async function checkTokenBalances(wallet, proxy) {
    try {
        const provider = createProviderWithProxy(proxy);
        const walletAddress = new ethers.Wallet(wallet).address;

        console.log(`Checking token balances for: ${walletAddress}`);
        for (const tokenAddress of tokensToClaimFrom) {
            try {
                const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                const balance = await tokenContract.balanceOf(walletAddress);
                console.log(`${tokenAddress}: ${ethers.formatEther(balance)} tokens`);
            } catch (err) {
                console.log(`Error checking balance for token ${tokenAddress}: ${err.message}`);
            }
        }
    } catch (error) {
        console.error(`Error checking token balances: ${error.message}`);
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function getUserChoice() {
    return new Promise((resolve) => {
        console.log('\n===== OPEN SCI AUTO BOT | AIRDROP INSIDERS =====');
        console.log('Please select an operation:');
        console.log('1) Claim tokens from faucet');
        console.log('2) Vote on projects');
        console.log('3) Both claim tokens and vote');
        console.log('4) Check balances');
        console.log('5) Schedule daily operations');
        console.log('6) Exit');
        rl.question('Enter your choice (1-6): ', (answer) => resolve(answer.trim()));
    });
}

async function processAccount(privateKey, proxy, index, total, shouldClaim, shouldVote, shouldCheckBalances) {
    console.log(`\n================================`);
    console.log(`Processing account ${index + 1}/${total}`);

    const walletAddress = new ethers.Wallet(privateKey).address;
    const balance = await checkBalance(privateKey, proxy);
    console.log(`Wallet address: ${walletAddress}`);
    console.log(`Current ETH balance: ${balance} ETH`);
    console.log(`Using proxy: ${proxy || 'No proxy'}`);

    if (parseFloat(balance) < 0.001) {
        console.warn('Warning: ETH balance may be too low for gas fees');
    }

    if (shouldCheckBalances) {
        await checkTokenBalances(privateKey, proxy);
    }

    let claimSuccess = false;
    let voteSuccess = false;

    if (shouldClaim) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (attempt > 1) console.log(`Claim attempt ${attempt}...`);
            claimSuccess = await claimTokens(privateKey, proxy);
            if (claimSuccess) break;
            if (attempt < 3) {
                console.log(`Waiting 5 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        if (shouldVote) {
            console.log(`Waiting 10 seconds before voting...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    if (shouldVote) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (attempt > 1) console.log(`Voting attempt ${attempt}...`);
            voteSuccess = await voteOnProjects(privateKey, proxy);
            if (voteSuccess) break;
            if (attempt < 3) {
                console.log(`Waiting 5 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    if ((shouldClaim || shouldVote || shouldCheckBalances) && (shouldClaim || shouldVote)) {
        console.log('\nChecking updated token balances:');
        await checkTokenBalances(privateKey, proxy);
    }

    return { claimSuccess: shouldClaim ? claimSuccess : null, voteSuccess: shouldVote ? voteSuccess : null };
}

async function processAccounts(shouldClaim, shouldVote, shouldCheckBalances = false) {
    const privateKeys = readPrivateKeys();
    const proxies = readProxies();

    if (privateKeys.length === 0) {
        console.error('No private keys found. Please check pk.txt file.');
        return;
    }

    console.log(`Found ${privateKeys.length} accounts to process.`);
    console.log(`Found ${proxies.length} proxies to use.`);

    const results = { successful: { claim: 0, vote: 0 }, failed: { claim: 0, vote: 0 }, skipped: { claim: 0, vote: 0 } };

    for (let i = 0; i < privateKeys.length; i++) {
        const proxy = proxies[i % proxies.length] || null;
        const { claimSuccess, voteSuccess } = await processAccount(
            privateKeys[i],
            proxy,
            i,
            privateKeys.length,
            shouldClaim,
            shouldVote,
            shouldCheckBalances
        );

        if (shouldClaim) {
            if (claimSuccess === true) results.successful.claim++;
            else if (claimSuccess === false) results.failed.claim++;
        } else {
            results.skipped.claim++;
        }

        if (shouldVote) {
            if (voteSuccess === true) results.successful.vote++;
            else if (voteSuccess === false) results.failed.vote++;
        } else {
            results.skipped.vote++;
        }

        if (i < privateKeys.length - 1) {
            const waitTime = 30000;
            console.log(`Waiting ${waitTime/1000} seconds before processing next account...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    console.log('\n================================');
    console.log('SUMMARY:');
    if (shouldClaim) {
        console.log(`Successful claims: ${results.successful.claim}/${privateKeys.length}`);
        console.log(`Failed claims: ${results.failed.claim}/${privateKeys.length}`);
    } else {
        console.log('Token claiming was skipped');
    }
    if (shouldVote) {
        console.log(`Successful votes: ${results.successful.vote}/${privateKeys.length}`);
        console.log(`Failed votes: ${results.failed.vote}/${privateKeys.length}`);
    } else {
        console.log('Project voting was skipped');
    }
    console.log('All accounts processed!');
}

function scheduleDaily(shouldClaim, shouldVote, shouldCheckBalances) {
    const now = new Date();
    console.log(`Bot started at: ${now.toLocaleString()}`);
    console.log(`Scheduled operations: ${shouldClaim ? 'Claim tokens' : ''} ${shouldClaim && shouldVote ? 'and' : ''} ${shouldVote ? 'Vote on projects' : ''}`);

    processAccounts(shouldClaim, shouldVote, shouldCheckBalances);

    const millisecondsInDay = 24 * 60 * 60 * 1000;
    setInterval(() => {
        const currentTime = new Date();
        console.log(`Running scheduled task at: ${currentTime.toLocaleString()}`);
        processAccounts(shouldClaim, shouldVote, shouldCheckBalances);
    }, millisecondsInDay);
}

async function mainMenu() {
    while (true) {
        const choice = await getUserChoice();

        switch (choice) {
            case '1':
                console.log('\nRunning token claim operation...');
                await processAccounts(true, false, false);
                break;
            case '2':
                console.log('\nRunning voting operation...');
                await processAccounts(false, true, false);
                break;
            case '3':
                console.log('\nRunning both claim and voting operations...');
                await processAccounts(true, true, false);
                break;
            case '4':
                console.log('\nChecking balances...');
                await processAccounts(false, false, true);
                break;
            case '5':
                console.log('\nSetting up scheduled operations...');
                rl.question('Include token claiming? (y/n): ', async (claimAnswer) => {
                    const shouldClaim = claimAnswer.toLowerCase() === 'y';
                    rl.question('Include project voting? (y/n): ', (voteAnswer) => {
                        const shouldVote = voteAnswer.toLowerCase() === 'y';
                        rl.question('Check token balances before/after operations? (y/n): ', (balanceAnswer) => {
                            const shouldCheckBalances = balanceAnswer.toLowerCase() === 'y';
                            if (!shouldClaim && !shouldVote && !shouldCheckBalances) {
                                console.log('You must select at least one operation to schedule');
                                return mainMenu();
                            }
                            console.log('\nStarting scheduled operations...');
                            scheduleDaily(shouldClaim, shouldVote, shouldCheckBalances);
                            rl.close();
                        });
                    });
                });
                return;
            case '6':
                console.log('Exiting application.');
                rl.close();
                return;
            default:
                console.log('Invalid choice. Please enter a number between 1 and 6.');
        }
    }
}

// Start the application with menu
mainMenu();