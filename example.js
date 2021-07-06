const ethers = require('ethers')
const { Watcher } = require('@eth-optimism/watcher')
const { getContractFactory } = require('@eth-optimism/contracts')

const chai = require('chai');
var expect = chai.expect;
var assert = chai.assert;
// var assert = require('assert');


// Set up some contract factories. You can ignore this stuff.
const factory = (name, ovm = false) => {
  const artifact = require(`./artifacts${ovm ? '-ovm' : ''}/contracts/${name}.sol/${name}.json`)
  return new ethers.ContractFactory(artifact.abi, artifact.bytecode)
}
const factory__L1_ERC20 = factory('ERC20')
const factory__L2_ERC20 = factory('L2DepositedERC20', true)
const factory__L1_ERC20Gateway = getContractFactory('OVM_L1ERC20Gateway')
const factory__L2_Staking = factory('L2StakingERC20', true)

async function main() {
  // Set up our RPC provider connections.
  const l1RpcProvider = new ethers.providers.JsonRpcProvider('http://localhost:9545')
  const l2RpcProvider = new ethers.providers.JsonRpcProvider('http://localhost:8545')

  // Set up our wallets (using a default private key with 10k ETH allocated to it).
  // Need two wallets objects, one for interacting with L1 and one for interacting with L2.
  // Both will use the same private key.
  const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const l1Wallet = new ethers.Wallet(key, l1RpcProvider)
  const l2Wallet = new ethers.Wallet(key, l2RpcProvider)

  const key2 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  const l1Wallet2 = new ethers.Wallet(key2, l1RpcProvider)
  const l2Wallet2 = new ethers.Wallet(key2, l2RpcProvider)

  // L1 messenger address depends on the deployment, this is default for our local deployment.
  const l1MessengerAddress = '0x59b670e9fA9D0A427751Af201D676719a970857b'
  // L2 messenger address is always the same.
  const l2MessengerAddress = '0x4200000000000000000000000000000000000007'

  // Tool that helps watches and waits for messages to be relayed between L1 and L2.
  const watcher = new Watcher({
    l1: {
      provider: l1RpcProvider,
      messengerAddress: l1MessengerAddress
    },
    l2: {
      provider: l2RpcProvider,
      messengerAddress: l2MessengerAddress
    }
  })

  before(async function () {
    // Deploy an ERC20 token on L1.
    console.log('Deploying L1 ERC20...')
    const L1_ERC20 = await factory__L1_ERC20.connect(l1Wallet).deploy(
      50000, //initialSupply
      'L1 ERC20', //name
    )
    await L1_ERC20.deployTransaction.wait()
    
    // Deploy the paired ERC20 token to L2.
    console.log('Deploying L2 ERC20...')
    const L2_ERC20 = await factory__L2_ERC20.connect(l2Wallet).deploy(
      l2MessengerAddress,
      'L2 ERC20', //name
      {
        gasPrice: 0
      }
    )
    await L2_ERC20.deployTransaction.wait()
  
    // Deploy the staking to L2
    console.log('Deploying L2 Staking...')
    const L2_Staking = await factory__L2_Staking.connect(l2Wallet).deploy(
      L2_ERC20.address,
      10,
      {
        gasPrice: 0    
      }
    )
    await L2_Staking.deployTransaction.wait()
  
    // Create a gateway that connects the two contracts.
    console.log('Deploying L1 ERC20 Gateway...')
    const L1_ERC20Gateway = await factory__L1_ERC20Gateway.connect(l1Wallet).deploy(
      L1_ERC20.address,
      L2_ERC20.address,
      l1MessengerAddress
    )
    await L1_ERC20Gateway.deployTransaction.wait()
    
    // Make the L2 ERC20 aware of the gateway contract.
    console.log('Initializing L2 ERC20...')
    const tx0 = await L2_ERC20.init(
      L1_ERC20Gateway.address,
      {
        gasPrice: 0
      }
    )
    await tx0.wait()
  
    console.log('transfer tokens for L1wallet2')
    const l1Tol1_2 = await L1_ERC20.connect(l1Wallet).transfer(l1Wallet2.address,2000)
    await l1Tol1_2.wait()

    // Allow the gateway to lock up some of our tokens.
    console.log('Approving tokens for ERC20 gateway...(L1wallet1)')
    const tx1 = await L1_ERC20.approve(L1_ERC20Gateway.address, 48000)
    await tx1.wait()
  
    console.log('Approving tokens for ERC20 gateway...(L1wallet2)')
    const tx1_2 = await L1_ERC20.connect(l1Wallet2).approve(L1_ERC20Gateway.address, 2000)
    await tx1_2.wait()
  
    // Lock the tokens up inside the gateway and ask the L2 contract to mint new ones.
    console.log('Depositing tokens into L2 ERC20...(l1wallet1)')
    const tx2 = await L1_ERC20Gateway.deposit(48000)
    await tx2.wait()
  
    console.log('Depositing tokens into L2 ERC20...(l1wallet2)')
    const tx2_2 = await L1_ERC20Gateway.connect(l1Wallet2).deposit(2000)
    await tx2_2.wait()
  
    // Wait for the message to be relayed to L2.
    console.log('Waiting for deposit to be relayed to L2...')
    const [ msgHash1 ] = await watcher.getMessageHashesFromL1Tx(tx2.hash)
    await watcher.getL2TransactionReceipt(msgHash1)
    
    const [ msgHash1_2 ] = await watcher.getMessageHashesFromL1Tx(tx2_2.hash)
    await watcher.getL2TransactionReceipt(msgHash1_2)
 
    // L2_ERC20 transfer test
    console.log('transfer token Layer2')
    const l2_transfer = await L2_ERC20.transfer(
      l2Wallet2.address,
      1000,
      {
        gasPrice: 0
      }
    )
    await l2_transfer.wait()
    // console.log(`Balance on L2: ${await L2_ERC20.balanceOf(l2Wallet.address)}`) // 47000 
    // console.log(`Balance on L2_2: ${await L2_ERC20.balanceOf(l2Wallet2.address)}`) // 3000
  
    //token reward transfer
    const l2_transfer2 = await L2_ERC20.transfer(
      L2_Staking.address,
      40000,
      {
        gasPrice: 0
      }
    )
    await l2_transfer2.wait()

    console.log('--------------------------------')
    console.log('basic setting on Layer2')
    console.log(`Balance on L2: ${await L2_ERC20.balanceOf(l2Wallet.address)}`) // 7000 
    console.log(`Balance on L2_2: ${await L2_ERC20.balanceOf(l2Wallet2.address)}`) // 3000
    console.log(`Balance on L2_staking: ${await L2_ERC20.balanceOf(L2_Staking.address)}`) // 40000 
    console.log('--------------------------------')
  })

  beforeEach(async function () {
    console.log("staking test start")
  })

  describe("deposit the ton", function() {
    it("approve ton to stakingContract", async function () {
      const l2_stakeApprove = await L2_ERC20.connect(l2Wallet).approve(
        L2_Staking.address, 
        1000,
        {
          gasPrice: 0
        }
      )
      await l2_stakeApprove.wait()

      const l2_allowance = await L2_ERC20.connect(l2Wallet).allowance(
        l2Wallet.address,
        L2_Staking.address,
        {
          gasPrice: 0
        }
      )

      await expect(l2_allowance).to.be.equal(1000);
    })

    it("approve and deposit test", async function () {
      const l2_stakeApprove = await L2_ERC20.connect(l2Wallet).approve(
        L2_Staking.address, 
        1000,
        {
          gasPrice: 0
        }
      )
      await l2_stakeApprove.wait()

      console.log('--------------------------------')
      console.log('staking token Layer2')
      console.log('--------------------------------')
      const l2_staking = await L2_Staking.connect(l2Wallet).deposit(
        1000,
        {
          gasPrice: 0
        }
      )
      await l2_staking.wait()
      expect(await L2_ERC20.balanceOf(L2_Staking.address)).to.be.equal(41000)
      console.log(`Balance on L2: ${await L2_ERC20.balanceOf(l2Wallet.address)}`) // 6000
      console.log(`Balance on L2_2: ${await L2_ERC20.balanceOf(l2Wallet2.address)}`) // 3000 
      console.log(`Balance on L2_staking: ${await L2_ERC20.balanceOf(L2_Staking.address)}`) // 41000
    })
  })
 


  //unstake test
  // console.log('--------------------------------')
  // console.log('unstaking token Layer2')
  // console.log('--------------------------------')
  // const l2_unstaking = await L2_Staking.connect(l2Wallet).unstake(
  //   1000,
  //   {
  //     gasPrice: 0
  //   }
  // )
  // await l2_unstaking.wait()

  // console.log('--------------------------------')
  // console.log(`Balance on L2: ${await L2_ERC20.balanceOf(l2Wallet.address)}`) // 7000
  // console.log(`Balance on L2_2: ${await L2_ERC20.balanceOf(l2Wallet2.address)}`) // 2000 
  // console.log(`Balance on L2_staking: ${await L2_ERC20.balanceOf(L2_Staking.address)}`) // 41000
  // console.log('--------------------------------')

  // console.log('--------------------------------')
  // console.log('totalStakedFor l2Wallet Layer2')
  // console.log('--------------------------------')
  // const l2_totalStakedFor3 = await L2_Staking.totalStakedFor(
  //   l2Wallet.address,
  //   {
  //     gasPrice: 0
  //   }
  // )
  // console.log(l2_totalStakedFor3.toString())


  // // Burn the tokens on L2 and ask the L1 contract to unlock on our behalf.
  // console.log(`Withdrawing tokens back to L1 ERC20...`)
  // const tx3 = await L2_ERC20.withdraw(
  //   2000,
  //   {
  //     gasPrice: 0
  //   }
  // )
  // await tx3.wait()
  
  // console.log(`Withdrawing2 tokens back to L1 ERC20...`)
  // const tx4 = await L2_ERC20.connect(l2Wallet2).withdraw(
  //   2000,
  //   {
  //     gasPrice: 0
  //   }
  // )
  // await tx4.wait()

  // // Wait for the message to be relayed to L1.
  // console.log(`Waiting for withdrawal to be relayed to L1...`)
  // const [ msgHash2 ] = await watcher.getMessageHashesFromL2Tx(tx3.hash)
  // await watcher.getL1TransactionReceipt(msgHash2)

  // console.log(`Waiting for withdrawal2 to be relayed to L1...`)
  // const [ msgHash2_2 ] = await watcher.getMessageHashesFromL2Tx(tx4.hash)
  // await watcher.getL1TransactionReceipt(msgHash2_2)

  // // Log balances again!
  // console.log(`Balance on L1: ${await L1_ERC20.balanceOf(l1Wallet.address)}`) // 2000
  // console.log(`Balance on L2: ${await L2_ERC20.balanceOf(l1Wallet.address)}`) // 0
  // console.log(`Balance on L1_2: ${await L1_ERC20.balanceOf(l1Wallet2.address)}`) // 2000
  // console.log(`Balance on L2_2: ${await L2_ERC20.balanceOf(l1Wallet2.address)}`) // 1000
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
