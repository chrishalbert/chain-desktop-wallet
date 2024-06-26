import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FormInstance, Spin, Table } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

import './LedgerAddressIndexBalanceTable.less';

import { UserAssetType, scaledAmountByAsset } from '../../../models/UserAsset';
import { CronosClient } from '../../../service/cronos/CronosClient';
import {
  CRONOS_TENDERMINT_ASSET,
  CRONOS_EVM_ASSET,
  MainNetEvmConfig,
  ETH_ASSET,
  ATOM_TENDERMINT_ASSET,
} from '../../../config/StaticAssets';
import { DefaultWalletConfigs, SupportedChainName } from '../../../config/StaticConfig';
import { NodeRpcService } from '../../../service/rpc/NodeRpcService';
import { LedgerSigner } from '../../../service/signers/LedgerSigner';
import { ISignerProvider } from '../../../service/signers/SignerProvider';
import { createLedgerDevice } from '../../../service/LedgerService';
import { ledgerNotificationWithoutCheck } from '../../../components/LedgerNotification/LedgerNotification';
import { renderExplorerUrl } from '../../../models/Explorer';
import { EthClient } from '../../../service/ethereum/EthClient';

const LedgerAddressIndexBalanceTable = (props: {
  addressIndexBalanceList;
  form?: FormInstance;
  assetType: UserAssetType;
  chainName: SupportedChainName;
  setisHWModeSelected?: (value: boolean) => void;
  setDerivationPath?: ({ cronosTendermint, cosmosTendermint, evm }) => void;
  setAddressIndexBalanceList: (list: any[]) => void;
}) => {
  const DEFAULT_START_INDEX = 10;
  const DEFAULT_GAP = 10;
  const {
    addressIndexBalanceList: rawAddressIndexBalanceList,
    setAddressIndexBalanceList: setRawAddressIndexBalanceList,
    assetType,
    chainName,
    form,
    setisHWModeSelected,
    setDerivationPath,
  } = props;
  const [addressIndexBalanceList, setAddressIndexBalanceList] = useState<any[]>([]);
  const [startIndex, setStartIndex] = useState<number>(DEFAULT_START_INDEX);
  const [loading, setLoading] = useState<boolean>(false);
  const [t] = useTranslation();

  const network = props.form?.getFieldValue('network');
  const isTestnet = network === DefaultWalletConfigs.TestNetCroeseid5Config.name;
  const config = isTestnet
    ? DefaultWalletConfigs.TestNetCroeseid5Config
    : DefaultWalletConfigs.MainNetConfig;
  const cronosTendermintAsset = {
    ...CRONOS_TENDERMINT_ASSET(config),
    walletId: '',
  };

  const cronosEvmAsset = {
    ...CRONOS_EVM_ASSET(config),
    walletId: '',
  };

  const ethEvmAsset = {
    ...ETH_ASSET(config),
    walletId: '',
  };

  const atomTendermintAsset = {
    ...ATOM_TENDERMINT_ASSET(config),
    walletId: '',
  };

  const tableColumns = [
    {
      title: t('wallet.table1.address'),
      dataIndex: 'publicAddress',
      key: 'publicAddress',
      render: publicAddress => {
        let url;
        switch (`${assetType}-${chainName}`) {
          case `${UserAssetType.EVM}-${SupportedChainName.CRONOS}`:
            url = `${renderExplorerUrl(cronosEvmAsset.config, 'address')}/${publicAddress}`;
            break;
          case `${UserAssetType.EVM}-${SupportedChainName.ETHEREUM}`:
            url = `${renderExplorerUrl(ethEvmAsset.config, 'address')}/${publicAddress}`;
            break;
          case `${UserAssetType.TENDERMINT}-${SupportedChainName.CRONOS_TENDERMINT}`:
            url = `${renderExplorerUrl(cronosTendermintAsset.config, 'address')}/${publicAddress}`;
            break;
          case `${UserAssetType.TENDERMINT}-${SupportedChainName.COSMOS_HUB}`:
            url = `${renderExplorerUrl(atomTendermintAsset.config, 'address')}/${publicAddress}`;
            break;
          default:
            url = `${renderExplorerUrl(cronosTendermintAsset.config, 'address')}/${publicAddress}`;
        }
        return (
          <a data-original={publicAddress} target="_blank" rel="noreferrer" href={url}>
            {publicAddress}
          </a>
        );
      },
    },
    {
      title: t('create.formCustomConfig.derivationPath.label'),
      dataIndex: 'derivationPath',
      key: 'derivationPath',
      render: derivationPath => {
        return <span>{derivationPath}</span>;
      },
    },
    {
      title: t('home.assetList.table.amount'),
      dataIndex: 'balance',
      key: 'balance',
      render: balance => {
        return (
          <>
            <span>{balance.toString()}</span>
          </>
        );
      },
    },
    {
      title: t('general.action'),
      key: 'action',
      render: record => (
        <a
          onClick={() => {
            if (setisHWModeSelected) {
              setisHWModeSelected(false);
            }
            if (form && setDerivationPath) {
              form.setFieldsValue({
                addressIndex: record.index,
              });
              setDerivationPath({
                cronosTendermint: LedgerSigner.getDerivationPath(
                  record.index,
                  UserAssetType.TENDERMINT,
                  SupportedChainName.CRONOS_TENDERMINT,
                  form.getFieldValue('derivationPathStandard'),
                ),
                cosmosTendermint: LedgerSigner.getDerivationPath(
                  record.index,
                  UserAssetType.TENDERMINT,
                  SupportedChainName.COSMOS_HUB,
                  form.getFieldValue('derivationPathStandard'),
                ),
                evm: LedgerSigner.getDerivationPath(
                  record.index,
                  UserAssetType.EVM,
                  SupportedChainName.CRONOS,
                  form.getFieldValue('derivationPathStandard'),
                ),
              });
            }
          }}
        >
          {t('general.select')}
        </a>
      ),
    },
  ];

  const processLedgerAccountsList = async (ledgerAccountList: any[]) => {
    setLoading(true);
    switch (`${assetType}-${chainName}`) {
      case `${UserAssetType.TENDERMINT}-${SupportedChainName.CRONOS_TENDERMINT}`: {
        const config = isTestnet
          ? DefaultWalletConfigs.TestNetCroeseid5Config
          : DefaultWalletConfigs.MainNetConfig;
        const nodeRpc = await NodeRpcService.init({
          baseUrl: config.nodeUrl,
          clientUrl: config.tendermintNetwork?.node?.clientUrl,
          proxyUrl: config.tendermintNetwork?.node?.proxyUrl,
        });
        await Promise.all(
          ledgerAccountList.map(async account => {
            const { publicAddress } = account;
            const nativeBalance = await nodeRpc.loadAccountBalance(
              publicAddress,
              isTestnet ? 'basetcro' : 'basecro',
            );
            account.balance = `${scaledAmountByAsset(nativeBalance, cronosTendermintAsset)} ${cronosTendermintAsset.symbol}`;
          }),
        ).then(() => {
          setAddressIndexBalanceList(ledgerAccountList);
          setLoading(false);
        });

        break;
      }
      case `${UserAssetType.TENDERMINT}-${SupportedChainName.COSMOS_HUB}`: {
        const nodeRpc = await NodeRpcService.init({
          baseUrl: atomTendermintAsset.config.nodeUrl,
          clientUrl: atomTendermintAsset.config.tendermintNetwork?.node?.clientUrl,
          proxyUrl: atomTendermintAsset.config.tendermintNetwork?.node?.proxyUrl,
        });
        await Promise.all(
          ledgerAccountList.map(async account => {
            const { publicAddress } = account;
            const nativeBalance = await nodeRpc.loadAccountBalance(
              publicAddress,
              isTestnet ? 'uatom' : 'uatom',
            );
            account.balance = `${scaledAmountByAsset(nativeBalance, atomTendermintAsset)} ${atomTendermintAsset.symbol}`;
          }),
        ).then(() => {
          setAddressIndexBalanceList(ledgerAccountList);
          setLoading(false);
        });
        break;
      }
      case `${UserAssetType.EVM}-${SupportedChainName.CRONOS}`: {
        const cronosClient = new CronosClient(
          MainNetEvmConfig.nodeUrl,
          MainNetEvmConfig.indexingUrl,
        );

        await Promise.all(
          ledgerAccountList.map(async account => {
            const { publicAddress } = account;
            const nativeBalance = await cronosClient.getNativeBalanceByAddress(publicAddress);
            account.balance = `${scaledAmountByAsset(nativeBalance, cronosEvmAsset)} ${cronosEvmAsset.symbol}`;
          }),
        ).then(() => {
          setAddressIndexBalanceList(ledgerAccountList);
          setLoading(false);
        });
        break;
      }
      case `${UserAssetType.EVM}-${SupportedChainName.ETHEREUM}`: {
        const ethClient = new EthClient(
          ethEvmAsset.config.nodeUrl,
          ethEvmAsset.config.indexingUrl,
        );

        await Promise.all(
          ledgerAccountList.map(async account => {
            const { publicAddress } = account;
            const nativeBalance = await ethClient.getNativeBalanceByAddress(publicAddress);
            account.balance = `${scaledAmountByAsset(nativeBalance, ethEvmAsset)} ${ethEvmAsset.symbol}`;
          }),
        ).then(() => {
          setAddressIndexBalanceList(ledgerAccountList);
          setLoading(false);
        });
        break;
      }
      default:
    }
  };

  const onLoadMoreAddressList = async () => {
    const device: ISignerProvider = createLedgerDevice();
    const standard = form?.getFieldValue('derivationPathStandard');

    try {
      switch (`${assetType}-${chainName}`) {
        case `${UserAssetType.EVM}-${SupportedChainName.CRONOS}`:
          {
            const ethAddressList = await device.getEthAddressList(
              startIndex,
              DEFAULT_GAP,
              standard,
            );
            if (ethAddressList) {
              const returnList = ethAddressList.map((address, idx) => {
                return {
                  index: startIndex + idx,
                  publicAddress: address,
                  derivationPath: LedgerSigner.getDerivationPath(
                    startIndex + idx,
                    UserAssetType.EVM,
                    SupportedChainName.CRONOS,
                    standard,
                  ),
                  balance: '0',
                };
              });
              setStartIndex(startIndex + DEFAULT_GAP);
              setRawAddressIndexBalanceList(rawAddressIndexBalanceList.concat(returnList));
            }
          }
          break;
        case `${UserAssetType.EVM}-${SupportedChainName.ETHEREUM}`:
          {
            const ethAddressList = await device.getEthAddressList(
              startIndex,
              DEFAULT_GAP,
              standard,
            );
            if (ethAddressList) {
              const returnList = ethAddressList.map((address, idx) => {
                return {
                  index: startIndex + idx,
                  publicAddress: address,
                  derivationPath: LedgerSigner.getDerivationPath(
                    startIndex + idx,
                    UserAssetType.EVM,
                    SupportedChainName.ETHEREUM,
                    standard,
                  ),
                  balance: '0',
                };
              });
              setStartIndex(startIndex + DEFAULT_GAP);
              setRawAddressIndexBalanceList(rawAddressIndexBalanceList.concat(returnList));
            }
          }
          break;
        case `${UserAssetType.TENDERMINT}-${SupportedChainName.CRONOS_TENDERMINT}`:
          {
            const tendermintAddressList = await device.getAddressList(
              startIndex,
              DEFAULT_GAP,
              isTestnet ? 'tcro' : 'cro',
              SupportedChainName.CRONOS_TENDERMINT,
              standard,
            );
            if (tendermintAddressList) {
              const returnList = tendermintAddressList.map((address, idx) => {
                return {
                  index: startIndex + idx,
                  publicAddress: address,
                  derivationPath: LedgerSigner.getDerivationPath(
                    startIndex + idx,
                    UserAssetType.TENDERMINT,
                    SupportedChainName.CRONOS_TENDERMINT,
                    standard,
                  ),
                  balance: '0',
                };
              });
              setStartIndex(startIndex + DEFAULT_GAP);
              setRawAddressIndexBalanceList(rawAddressIndexBalanceList.concat(returnList));
            }
          }
          break;
        case `${UserAssetType.TENDERMINT}-${SupportedChainName.COSMOS_HUB}`:
          {
            const cosmosHubAddressList = await device.getAddressList(
              startIndex,
              DEFAULT_GAP,
              'cosmos',
              SupportedChainName.COSMOS_HUB,
              standard,
            );
            if (cosmosHubAddressList) {
              const returnList = cosmosHubAddressList.map((address, idx) => {
                return {
                  index: startIndex + idx,
                  publicAddress: address,
                  derivationPath: LedgerSigner.getDerivationPath(
                    startIndex + idx,
                    UserAssetType.TENDERMINT,
                    SupportedChainName.COSMOS_HUB,
                    standard,
                  ),
                  balance: '0',
                };
              });
              setStartIndex(startIndex + DEFAULT_GAP);
              setRawAddressIndexBalanceList(rawAddressIndexBalanceList.concat(returnList));
            }
          }
          break;
        default:
      }
    } catch {
      ledgerNotificationWithoutCheck(assetType, chainName);
    }
  };

  useEffect(() => {
    const syncAddressIndexBalanceList = () => {
      processLedgerAccountsList(rawAddressIndexBalanceList);
    };

    syncAddressIndexBalanceList();
  }, [rawAddressIndexBalanceList]);

  useEffect(() => {
    setStartIndex(DEFAULT_START_INDEX);
  }, [assetType, chainName]);

  return (
    <div className="address-index-balance-list">
      {rawAddressIndexBalanceList.length > 0 ? (
        <>
          <Table
            locale={{
              triggerDesc: t('general.table.triggerDesc'),
              triggerAsc: t('general.table.triggerAsc'),
              cancelSort: t('general.table.cancelSort'),
            }}
            dataSource={addressIndexBalanceList}
            columns={tableColumns}
            pagination={{ showSizeChanger: false }}
            defaultExpandAllRows
            loading={{
              indicator: <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />,
              spinning: loading,
            }}
          />
          <Button
            type="ghost"
            style={{ float: 'right', marginRight: '0', border: '0', boxShadow: 'none' }}
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setTimeout(() => {
                onLoadMoreAddressList();
                setLoading(false);
              }, 500);
            }}
          >
            {t('general.loadMore')}
          </Button>
        </>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LedgerAddressIndexBalanceTable;
