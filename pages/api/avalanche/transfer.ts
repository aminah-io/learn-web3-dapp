import type {NextApiRequest, NextApiResponse} from 'next';
import {getAvalancheClient} from '@figment-avalanche/lib';
import {BinTools, BN} from 'avalanche';

export default async function transfer(
  req: NextApiRequest,
  res: NextApiResponse<string>,
) {
  try {
    const {secret, navax, recipient, address, network} = req.body;
    const client = getAvalancheClient(network);
    const chain = client.XChain();
    const keychain = chain.keyChain();
    // Using keychain, load the private key to sign transactions
    keychain.importKey(secret);

    // Fetch UTXOs (unspent transaction outputs)
    const {utxos} = await chain.getUTXOs(address);

    // Determine the real asset ID from its symbol/alias
    const binTools = BinTools.getInstance();
    const assetInfo = await chain.getAssetDescription('AVAX');
    const assetID = binTools.cb58Encode(assetInfo.assetID);

    // Create a new transaction
    let sendAmount = new BN(navax);
    const transaction = await chain.buildBaseTx(
      utxos,
      sendAmount,
      assetID,
      [recipient],
      [address],
      [address],
    );

    // Sign the transaction and send it to the network
    let signedTx = transaction.sign(keychain);
    let hash = await chain.issueTx(signedTx);

    res.status(200).json(hash);
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : 'Unknown Error';
    res.status(500).json(errorMessage);
  }
}
