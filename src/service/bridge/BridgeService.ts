import { getBech32AddressFromEVMAddress } from '@crypto-org-chain/chain-jslib/lib/dist/utils/address';
import { AbiItem } from 'web3-utils';
import Web3 from 'web3';
import { TransactionConfig } from 'web3-eth';
import { CroNetwork } from '@crypto-org-chain/chain-jslib/lib/dist/core/cro';
import { BridgeTransferRequest } from '../TransactionRequestModels';
import { BroadCastResult } from '../../models/Transaction';
import { BridgeTransactionUnsigned } from '../signers/TransactionSupported';
import { LEDGER_WALLET_TYPE } from '../LedgerService';
import { WalletBaseService } from '../WalletBaseService';
import { getBaseScaledAmount } from '../../utils/NumberUtils';
import BridgeABI from './contracts/BridgeABI.json';
import { CronosClient } from '../cronos/CronosClient';
import { evmTransactionSigner } from '../signers/EvmTransactionSigner';
import {
  BridgeConfig,
  BridgeNetworkConfigType,
  BridgeTransferDirection,
  DefaultMainnetBridgeConfigs,
  DefaultTestnetBridgeConfigs,
} from './BridgeConfig';
import { Network } from '../../config/StaticConfig';
import { Session } from '../../models/Session';

class BridgeService extends WalletBaseService {
  public async handleBridgeTransaction(
    bridgeTransferRequest: BridgeTransferRequest,
  ): Promise<BroadCastResult> {
    const { bridgeTransferDirection } = bridgeTransferRequest;

    switch (bridgeTransferDirection) {
      case BridgeTransferDirection.CRYPTO_ORG_TO_CRONOS: {
        return await this.handleCryptoOrgToCronosTransfer(bridgeTransferRequest);
      }

      case BridgeTransferDirection.CRONOS_TO_CRYPTO_ORG: {
        return await this.handleCronosToCryptoOrgTransfer(bridgeTransferRequest);
      }

      case BridgeTransferDirection.ETH_TO_CRONOS:
        throw new TypeError('Bridge  transfer direction not supported yet');

        break;
      case BridgeTransferDirection.CRONOS_TO_ETH:
        throw new TypeError('Bridge  transfer direction not supported yet');

        break;
      default:
        throw new TypeError('Unknown bridge  transfer direction');
    }
  }

  private async handleCronosToCryptoOrgTransfer(bridgeTransferRequest: BridgeTransferRequest) {
    const { originAsset } = bridgeTransferRequest;

    if (bridgeTransferRequest.walletType === LEDGER_WALLET_TYPE) {
      throw TypeError(
        `${LEDGER_WALLET_TYPE} not supported yet for ${bridgeTransferRequest.bridgeTransferDirection} transactions yet. Coming soon`,
      );
    }

    if (!originAsset.config?.nodeUrl || !originAsset.address) {
      throw TypeError(`Missing asset config: ${originAsset.config}`);
    }

    const cronosClient = new CronosClient(
      originAsset.config?.nodeUrl,
      originAsset.config?.indexingUrl,
    );

    const web3 = new Web3(originAsset.config?.nodeUrl);

    const txConfig: TransactionConfig = {
      from: bridgeTransferRequest.evmAddress,
      to: bridgeTransferRequest.tendermintAddress,
      value: web3.utils.toWei(bridgeTransferRequest.amount, 'ether'),
    };

    const prepareTxInfo = await this.prepareEVMTransaction(originAsset, txConfig);

    const { defaultBridgeConfig, loadedBridgeConfig } = await this.getCurrentBridgeConfig(
      prepareTxInfo.currentSession,
      bridgeTransferRequest,
    );

    // TODO: Load contract address from Bridge configuration object
    const bridgeContractABI = BridgeABI as AbiItem[];
    const bridgeContractAddress =
      loadedBridgeConfig?.cronosBridgeContractAddress ||
      defaultBridgeConfig.cronosBridgeContractAddress;
    const contract = new web3.eth.Contract(bridgeContractABI, bridgeContractAddress);
    const encodedABI = contract.methods
      .send_cro_to_crypto_org(bridgeTransferRequest.tendermintAddress)
      .encodeABI();

    // eslint-disable-next-line no-console
    console.log('Encoded Contract ABI', encodedABI);

    const scaledBaseAmount = getBaseScaledAmount(bridgeTransferRequest.amount, originAsset);

    const bridgeTransaction: BridgeTransactionUnsigned = {
      amount: scaledBaseAmount,
      fromAddress: bridgeTransferRequest.evmAddress,
      toAddress: bridgeContractAddress,
      memo: `bridge:desktop-wallet-client`,
      data: encodedABI,
      accountNumber: 0,
      accountSequence: 0,
    };

    bridgeTransaction.nonce = prepareTxInfo.nonce;
    bridgeTransaction.gasPrice = prepareTxInfo.loadedGasPrice;
    bridgeTransaction.gasLimit = prepareTxInfo.gasLimit;

    const signedTransaction = await evmTransactionSigner.signBridgeTransfer(
      bridgeTransaction,
      bridgeTransferRequest.decryptedPhrase,
    );

    // eslint-disable-next-line no-console
    console.log(`${bridgeTransferRequest.originAsset.assetType} REQUEST & SIGNED-TX`, {
      signedTransaction,
      bridgeTransaction,
    });

    const broadcastedTransactionHash = await cronosClient.broadcastRawTransactionHex(
      signedTransaction,
    );

    return {
      transactionHash: broadcastedTransactionHash,
      message: '',
      code: 200,
    };
  }

  private async handleCryptoOrgToCronosTransfer(bridgeTransferRequest: BridgeTransferRequest) {
    if (!bridgeTransferRequest.tendermintAddress || !bridgeTransferRequest.evmAddress) {
      throw new TypeError(
        `The Bech32 address and EVM address are required for doing ${bridgeTransferRequest.bridgeTransferDirection} transfer`,
      );
    }

    const {
      nodeRpc,
      accountNumber,
      accountSequence,
      transactionSigner,
      ledgerTransactionSigner,
      currentSession,
    } = await this.prepareTransaction();

    const scaledBaseAmount = getBaseScaledAmount(
      bridgeTransferRequest.amount,
      bridgeTransferRequest.originAsset,
    );
    const { defaultBridgeConfig, loadedBridgeConfig } = await this.getCurrentBridgeConfig(
      currentSession,
      bridgeTransferRequest,
    );

    const evmToBech32ConvertedRecipient = getBech32AddressFromEVMAddress(
      bridgeTransferRequest.evmAddress,
      loadedBridgeConfig?.prefix || defaultBridgeConfig.prefix,
    );

    const bridgeTransaction: BridgeTransactionUnsigned = {
      amount: scaledBaseAmount,
      fromAddress: bridgeTransferRequest.tendermintAddress,
      toAddress: evmToBech32ConvertedRecipient,
      accountNumber,
      accountSequence,
      channel: loadedBridgeConfig?.bridgeChannel || defaultBridgeConfig.bridgeChannel,
      port: loadedBridgeConfig?.bridgePort || defaultBridgeConfig.bridgePort,
      memo: `bridge:desktop-wallet-client`,
    };

    let signedTxHex: string = '';

    if (bridgeTransferRequest.walletType === LEDGER_WALLET_TYPE) {
      signedTxHex = await ledgerTransactionSigner.signIBCTransfer(
        bridgeTransaction,
        bridgeTransferRequest.decryptedPhrase,
      );
    } else {
      signedTxHex = await transactionSigner.signIBCTransfer(
        bridgeTransaction,
        bridgeTransferRequest.decryptedPhrase,
      );
    }
    return await nodeRpc.broadcastTransaction(signedTxHex);
  }

  public async getCurrentBridgeConfig(
    currentSession: Session,
    bridgeTransferRequest: BridgeTransferRequest,
  ) {
    const isTestnet = this.checkIfTestnet(currentSession.wallet.config.network);
    const bridgeNetworkConfigType = isTestnet
      ? BridgeNetworkConfigType.TESTNET_BRIDGE
      : BridgeNetworkConfigType.MAINNET_BRIDGE;
    const defaultBridgeConfig: BridgeConfig = isTestnet
      ? DefaultTestnetBridgeConfigs[bridgeTransferRequest.bridgeTransferDirection]
      : DefaultMainnetBridgeConfigs[bridgeTransferRequest.bridgeTransferDirection];

    const loadedBridgeConfig = await this.loadBridgeConfig(
      bridgeTransferRequest.bridgeTransferDirection,
      bridgeNetworkConfigType,
    );
    return { defaultBridgeConfig, loadedBridgeConfig };
  }

  public async retrieveBridgeConfig(
    bridgeDirectionType: BridgeTransferDirection,
  ): Promise<BridgeConfig> {
    const currentSession = await this.storageService.retrieveCurrentSession();
    const isTestnet = this.checkIfTestnet(currentSession.wallet.config.network);
    const bridgeNetworkConfigType = isTestnet
      ? BridgeNetworkConfigType.TESTNET_BRIDGE
      : BridgeNetworkConfigType.MAINNET_BRIDGE;

    return this.loadBridgeConfig(bridgeDirectionType, bridgeNetworkConfigType);
  }

  public async loadBridgeConfig(
    bridgeDirectionType: BridgeTransferDirection,
    bridgeNetwork: BridgeNetworkConfigType,
  ): Promise<BridgeConfig> {
    const allConfigs = await this.storageService.fetchAllBridgeConfigs();
    // eslint-disable-next-line no-console
    console.log('ALL_BRIDGE_CONFIGS', allConfigs);

    if (!allConfigs || allConfigs.length < 1) {
      await this.storageService.saveBridgeConfigsList([
        DefaultMainnetBridgeConfigs.CRONOS_TO_CRYPTO_ORG,
        DefaultMainnetBridgeConfigs.CRYPTO_ORG_TO_CRONOS,

        DefaultTestnetBridgeConfigs.CRONOS_TO_CRYPTO_ORG,
        DefaultTestnetBridgeConfigs.CRYPTO_ORG_TO_CRONOS,
      ]);
    }

    return this.storageService.findBridgeConfigByNetworkAndBridgeTransactionType(
      bridgeDirectionType,
      bridgeNetwork,
    );
  }

  public async updateBridgeConfiguration(bridgeConfig: BridgeConfig) {
    return this.storageService.saveBridgeConfig(bridgeConfig);
  }

  public checkIfTestnet = (network: Network) => {
    return (
      [CroNetwork.TestnetCroeseid3, CroNetwork.TestnetCroeseid4, CroNetwork.Testnet].includes(
        network,
      ) || network.defaultNodeUrl.includes('testnet')
    );
  };
}

export const bridgeService = new BridgeService();