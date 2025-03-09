const fs = require('fs');
const { ethers } = require('ethers');
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

async function approveTokensForVoting(wallet) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
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

async function voteOnProjects(wallet) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
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

        const approvalSuccess = await approveTokensForVoting(wallet);
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
            const provider = new ethers.JsonRpcProvider(RPC_URL);
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

async function claimTokens(wallet) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
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

            // Cek logs transaksi untuk pesan kesalahan yang lebih spesifik
            if (receipt.logs && receipt.logs.length > 0) {
                const errorLog = receipt.logs.find(log => log.topics.length > 0);
                if (errorLog) {
                    // Anda mungkin perlu menyesuaikan ini berdasarkan struktur log kontrak
                    const errorMessage = errorLog.data;
                    if (errorMessage.includes('already claimed')) {
                        console.log('?? Tidak dapat mengklaim token saat ini. Sudah diklaim sebelumnya.');
                    } else if (errorMessage.includes('time limit')) {
                        console.log('?? Tidak dapat mengklaim token saat ini. Batasan waktu belum terpenuhi.');
                    } else {
                        console.log('? Klaim token gagal karena alasan lain.');
                    }
                } else {
                    console.log('? Klaim token gagal karena alasan lain.');
                }
            } else {
                console.log('? Klaim token gagal karena alasan lain.');
            }
            return false;
        }

        console.log(`Claim transaction confirmed! Gas used: ${receipt.gasUsed}`);
        console.log('? Klaim token berhasil!');
        return true;

    } catch (error) {
        console.error(`Error claiming tokens: ${error.message}`);
        if (error.message.includes('time limit') || error.message.includes('already claimed')) {
            console.log('?? Tidak dapat mengklaim token saat ini. Sudah diklaim sebelumnya.');
        }
        if (error.transaction) console.log('Transaction data:', error.transaction);
        if (error.receipt) console.log('Receipt:', error.receipt);
        return false;
    }
}

async function checkBalance(wallet) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const balance = await provider.getBalance(new ethers.Wallet(wallet).address);
        return ethers.formatEther(balance);
    } catch (error) {
        console.error(`Error checking balance: ${error.message}`);
        return '0';
    }
}

async function checkTokenBalances(wallet) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
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

async function processAccount(privateKey, index, total) {
    console.log(`\n================================`);
    console.log(`Processing account ${index + 1}/${total}`);

    const walletAddress = new ethers.Wallet(privateKey).address;
    const balance = await checkBalance(privateKey);
    console.log(`Wallet address: ${walletAddress}`);
    console.log(`Current ETH balance: ${balance} ETH`);

    if (parseFloat(balance) < 0.001) {
        console.warn('Warning: ETH balance may be too low for gas fees');
    }

    await checkTokenBalances(privateKey);

    let claimSuccess = false;
    let voteSuccess = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) console.log(`Claim attempt ${attempt}...`);
        claimSuccess = await claimTokens(privateKey);
        if (claimSuccess) break;
        if (attempt < 3) {
            console.log(`Waiting 5 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    console.log(`Waiting 10 seconds before voting...`);
    await new Promise(resolve => setTimeout(resolve, 10000));

    for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) console.log(`Voting attempt ${attempt}...`);
        voteSuccess = await voteOnProjects(privateKey);
        if (voteSuccess) break;
        if (attempt < 3) {
            console.log(`Waiting 5 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    console.log('\nChecking updated token balances:');
    await checkTokenBalances(privateKey);

    return { claimSuccess, voteSuccess };
}

async function processAccounts() {
    const privateKeys = readPrivateKeys();

    if (privateKeys.length === 0) {
        console.error('No private keys found. Please check pk.txt file.');
        return;
    }

    console.log(`Found ${privateKeys.length} accounts to process.`);

    const results = { successful: { claim: 0, vote: 0 }, failed: { claim: 0, vote: 0 } };

    for (let i = 0; i < privateKeys.length; i++) {
        const { claimSuccess, voteSuccess } = await processAccount(
            privateKeys[i],
            i,
            privateKeys.length
        );

        if (claimSuccess === true) results.successful.claim++;
        else if (claimSuccess === false) results.failed.claim++;

        if (voteSuccess === true) results.successful.vote++;
        else if (voteSuccess === false) results.failed.vote++;

        if (i < privateKeys.length - 1) {
            const waitTime = 30000;
            console.log(`Waiting ${waitTime/1000} seconds before processing next account...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    console.log('\n================================');
    console.log('SUMMARY:');
    console.log(`Successful claims: ${results.successful.claim}/${privateKeys.length}`);
    console.log(`Failed claims: ${results.failed.claim}/${privateKeys.length}`);
    console.log(`Successful votes: ${results.successful.vote}/${privateKeys.length}`);
    console.log(`Failed votes: ${results.failed.vote}/${privateKeys.length}`);
    console.log('All accounts processed!');
}

async function main() {
    try {
        await processAccounts();
    } catch (error) {
        console.error('An error occurred during processing:', error);
    }
}

async function runScript() {
    try {
        await main();
        console.log('Script completed. Waiting for 24 hours before restarting...');
    } catch (error) {
        console.error('Script failed. Restarting in 24 hours...', error);
    } finally {
        setTimeout(() => {
            console.log('Restarting script after 24 hours...');
            runScript();
        }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
    }
}

// Start the script
runScript();
