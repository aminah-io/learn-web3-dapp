Before we start working on making swaps with actual tokens on the Solana devnet, we're going to create a mock implementation as a starting point. For this implementation, we will also link the buy & sell orders to a manual button press for testing.

Then we're going to work with some additional code libraries to perform token swaps on a Solana based DEX. This is where we will be able to swap our SOL for some USDC using the Orca pools on devnet so that we can begin using the liquidation bot. We'll go over the `OrcaSwapClient` which will be used to swap SOL for SPL tokens.

On mainnet, we have access to the more powerful Jupiter SDK where we can swap directly without needing to keep track of intermediate pairs. Again, the mainnet enabled code is primarily for illustration and should not be used without proper testing and understanding the inherent risks.

---

# 🧱 Building the Mock exchange component

You can find the `addMockOrder` function in `components/protocols/pyth/lib/wallet.tsx`:

```typescript
const addMockOrder = async (order: Order): Promise<SwapResult> => {
  const _jupiterSwapClient = await getJupiterSwapClient();

  // TokenA === SOL
  // TokenB === USDC
  const routes = await _jupiterSwapClient?.getRoutes({
    inputToken:
      order.side === 'buy'
        ? _jupiterSwapClient.tokenB
        : _jupiterSwapClient.tokenA,
    outputToken:
      order.side === 'buy'
        ? _jupiterSwapClient.tokenA
        : _jupiterSwapClient.tokenB,
    inputAmount: order.size,
    slippage: 1,
  });
  console.log('routes:', routes);
  const bestRoute = routes?.routesInfos[0];
  console.log('bestRoute:', bestRoute);
  const result = {
    inAmount: bestRoute?.inAmount || 0,
    outAmount: bestRoute?.outAmount || 0,
    txIds: [
      `mockTransaction_${Math.abs(Math.random()).toString().slice(2, 8)}`,
    ],
  };

  // Balance change for the mock wallet. This is not an actual transaction.
  setBalance((previousBalance) => ({
    ...previousBalance,
    usdc_balance:
      order.side === 'buy'
        ? previousBalance.usdc_balance - result.inAmount
        : previousBalance.usdc_balance + result.outAmount,
    sol_balance:
      order.side === 'buy'
        ? previousBalance.sol_balance + result.outAmount
        : previousBalance.sol_balance - result.inAmount,
  }));

  return result;
};
```

With a mock transaction, we'll use the Jupiter SDK to ensure the prices we're getting are indicative of mainnet. You'll notice that we are also passing in an `Order` object and getting back a `SwapResult`, but no swap is actually performed. The returned `txIds` array contains the identifier "mockTransaction\_" and a 6-digit random number. As part of this `addMockOrder` function, we also update the mock wallet balances.

---

# 🧱 Adding an order to the order book

```typescript
const addOrder = useCallback(
  async (order: Order) => {
    console.log('addOrder', useLive, order, cluster);
    let result: SwapResult;
    if (!useLive) {
      result = await addMockOrder(order);
    } else if (useLive) {
      if (cluster === 'devnet') {
        const _orcaClient = await getOrcaSwapClient();
        if (order.side === 'buy') {
          result = await _orcaClient?.buy(order.size)!;
          console.log('result:', result);
        } else if (order.side === 'sell') {
          if (order.toToken === 'ORCA') {
            console.log(_orcaClient);
            result = await _orcaClient?.sell_to_orca(order.size)!;
            console.log('result:', result);
          } else if (order.toToken === 'USDC') {
            console.log(_orcaClient);
            result = await _orcaClient?.sell(order.size)!;
            console.log('result:', result);
          }
        } else {
          console.log('Impossible!');
        }
      } else if (cluster === 'mainnet-beta') {
        console.log(jupiterSwapClient?.keypair.publicKey.toString());
        const _jupiterSwapClient = await getJupiterSwapClient();
        console.log(_jupiterSwapClient?.keypair.publicKey.toString());
        if (order.side === 'buy') {
          result = await _jupiterSwapClient?.buy(order.size);
        } else if (order.side === 'sell') {
          result = await _jupiterSwapClient?.sell(order.size);
        }
      }
    }
    if (result!) {
      const extendedOrder = {...order, ...result};
      setOrderbook((_orderBook) => [extendedOrder, ..._orderBook]);
    }

    mutate(); // Refresh balance
  },
  [useLive, cluster, keyPair],
);
```

# 🎠 Playground time

Take a few minutes and get comfortable with the mock swap process. Just switch the wallet over to "Mock", then click "Reset Wallet" to return the balances to their default amounts of 10 SOL and 1,400 USDC. You can then click on the **buy** or **sell** buttons located just above the Order book to perform a single trade, based on the best available route reported by Jupiter. Notice that the Transaction link is displayed as "mockT", and does not link to a valid transaction on solscan.io.

If you switch to the Live wallet, you will need to have some SOL in order to make swaps. The token values on the devnet Orca pools are a little out of line with the mainnet values, and you'll quickly notice that some swaps will fail due to an insufficient balance. The way we've tuned the liquidation bot is actually based on the true mainnet token values, so don't be alarmed if there are some failed swaps. It's a great way to learn about how the swaps work behind the scenes if you care to dig into it, but we'll leave out those details so that you don't get overwhelmed.

# 🧱 Building the Exchange component

Two files to be aware of here: The Exchange component `components/protocols/pyth/components/Exchange.tsx` which is being rendered on the right side of the screen and the helper code for performing swaps on devnet or mainnet, located in `components/protocols/pyth/lib/swap.ts`.

You'll notice that we have already included the price feed and wallet components for this step. There are also a few new components to consider:

- A textinput for the Yield Expectation
- Buttons to place buy and sell orders into the order book, kept in their own component
- A table component to maintain the order book

We've removed the chart component for now, but it will come back in the next step when we bring everything together!

# 🚚 Importing dependencies

We went over imports earlier in the pathway, the only new ones here are the Orca and Jupiter SDKs.

- [`@orca-so/sdk`](https://github.com/orca-so/typescript-sdk#orca-typescript-sdk) the Orca SDK enables us to create our `OrcaSwapClient`
- [`@jup-ag/core`](https://docs.jup.ag/jupiter-core/using-jupiter-core#usage) the Jupiter SDK enables us to create our `JupiterSwapClient`

```typescript
// components/protocols/pyth/lib/swap.ts

import {Cluster, Connection, Keypair, PublicKey} from '@solana/web3.js';
import {getOrca, OrcaPoolConfig, Network} from '@orca-so/sdk';
import {Jupiter, RouteInfo, TOKEN_LIST_URL} from '@jup-ag/core';
```

# 🏦 Associated Token Accounts

Working with SPL tokens on Solana can be tricky, but we'll go over the fundamentals quickly so you're up to speed. You can get more details from the [Solana docs on the topic](https://spl.solana.com/associated-token-account) if you're interested.

An Associated Token Account ("ATA") is an account owned by the SPL Token Program, associated with your public key. It is where SPL tokens of a specific mint address are stored and the balances can be viewed on most Solana block explorers. [solscan.io](https://solscan.io) has a tab on the account display page which will list your owned token balances.

Without going into too much detail, an ATA is required for Solana users to hold tokens. All we're doing here is using a couple of `Token` class methods, `getAssociatedTokenAddress` and `createAssociatedTokenAccountInstruction`. You don't need to read the code block below unless you want to see how those functions are being used. The [Solana Cookbook](https://solanacookbook.com) is a useful resource for code snippets related to SPL tokens.

```typescript
// components/protocols/pyth/lib/swap.ts

// ...
  async makeATA(mintPubkey: PublicKey) {
    let ata = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
      TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
      mintPubkey, // mint PublicKey
      this.keypair.publicKey, // owner
    );
    let tx = new Transaction().add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
        TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
        mintPubkey, // mint
        ata, // ata
        this.keypair.publicKey, // owner of token account
        this.keypair.publicKey, // fee payer
      ),
    );
    console.log(`ATA for ${mintPubkey}: ${ata.toBase58()}`);
    const txHash = await this.connection.sendTransaction(tx, [this.keypair]);
    return `${transactionSolscan('devnet', txHash)}` as String;
  }
// ...
```

# 🎁 Wrapping SOL

Wrapped SOL ("wSOL") is an SPL token. Sometimes it is necessary to be able to swap between SOL and other SPL tokens. We'll need an ATA for wSOL to be able to send this transaction. In most cases, the creation of this ATA is handled behind the scenes but we're exposing it here for your learning. The "Sync Native" instruction being sent to the SPL Token Program is what keeps the wSOL balance synced with the SOL balance of the ATA. You can pass an amount and the public key of the ATA to send the SOL to as the parameters.

As you can see, we are simply creating a transaction by adding instructions to the System Program and the SPL Token program.

The function returns a solscan.io URL for the transaction so that details are at your fingertips.

```typescript
// components/protocols/pyth/lib/swap.ts

  async wrapSOL(amount: number, ata: PublicKey) {
    let tx = new Transaction().add(
      // Transfer SOL
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: ata,
        lamports: amount,
      }),
      new TransactionInstruction({
        keys: [
          {
            pubkey: ata,
            isSigner: false,
            isWritable: true,
          },
        ],
        data: Buffer.from(new Uint8Array([17])),
        programId: TOKEN_PROGRAM_ID,
      }),
    );
    const txHash = await this.connection.sendTransaction(tx, [
      this.keypair,
      this.keypair,
    ]);
    return `${transactionSolscan('mainnet-beta', txHash)}` as String;
  }
```

# 📈 Buy & Sell Orders

We need to define what an Order looks like so that we can work with it in code. This is a data type which contains information about an order, including the tokens being swapped and the size of the order. This interface is defined in `components/protocols/pyth/lib/wallet.ts`

```typescript
// components/protocols/pyth/lib/wallet.ts

// Define the interface for an Order
interface Order {
  side: 'buy' | 'sell';
  size: number;
  price: number;
  fromToken: string;
  toToken: string;
}
```

To tie it together, we need to define the interface for SPL Tokens as well as SwapResults.

```typescript
// components/protocols/pyth/lib/swap.ts

// Token interface
export interface TokenI {
  chainId: number; // 101,
  address: string; // '8f9s1sUmzUbVZMoMh6bufMueYH1u4BJSM57RCEvuVmFp',
  symbol: string; // 'TRUE',
  name: string; // 'TrueSight',
  decimals: number; // 9,
  logoURI: string; // 'https://i.ibb.co/pKTWrwP/true.jpg',
  tags: string[]; // [ 'utility-token', 'capital-token' ]
}

// SwapResult interface
export interface SwapResult {
  inAmount: number;
  outAmount: number;
  txIds: string[];
}
```

We also need to keep track of the total worth of our assets based on the current market price, the React `useState` hook is an natural choice for this. We will also set up some more app state to handle the details of the orders. This is occurring in the `Exchange` component being displayed on the right side of the page:

```typescript
// components/protocols/pyth/components/Exchange.tsx

// State for tracking user worth with current Market Price.
const [worth, setWorth] = useState({initial: 0, current: 0});

// yieldExpectation is the amount of EMA to trigger buy/sell signals
const [yieldExpectation, setYield] = useState<number>(0.001);
const [orderSize, setOrderSize] = useState<number>(20); // USDC
const [price, setPrice] = useState<number | undefined>(undefined);
const [symbol, setSymbol] = useState<string | undefined>(undefined);
const [orderBook, setOrderbook] = useState<Order[]>([]);
```

Take a look at how we can update the current worth:

```typescript
// components/protocols/pyth/components/Exchange.tsx

useEffect(() => {
  // Update the current worth each price update.
  const currentWorth = wallet?.sol_balance * price! + wallet.usdc_balance;
  setWorth({...worth, current: currentWorth});
}, [price, orderSizeUSDC, setPrice]);
```

Let's break down the `OrcaSwapClient` to understand what's actually happening on Solana devnet when an order is executed:

```typescript
// components/protocols/pyth/lib/swap.ts
export class OrcaSwapClient {
  constructor(
    public readonly keypair: Keypair,
    public readonly connection: Connection,
  ) {}
```

The class constructor defines the `Keypair` and `Connection` as both _public_ and _readonly_ - this means we can trust that this data isn't being altered midway through the function. It's a mix of best practices and defensive programming 😉.

```typescript
// components/protocola/pyth/lib/swap.ts

  /**
   * @param size - The amount of token to swap;
   * @returns - TxIds, inAmount, outAmount
   */
  async sell(size: number): Promise<SwapResult> {
    console.log(`Current keypair has
      ${
        (await this.connection.getBalance(this.keypair.publicKey)) /
        LAMPORTS_PER_SOL
      } SOL`);

    const orca = getOrca(this.connection, Network.DEVNET);

    const orcaSOLPool = orca.getPool(OrcaPoolConfig.ORCA_SOL);
    const solToken = orcaSOLPool.getTokenB();
    const solAmount = new Decimal(0.1);

    const orcaUSDCPool = orca.getPool(OrcaPoolConfig.ORCA_USDC);
    const orcaToken = orcaSOLPool.getTokenA();
    const usdcToken = orcaUSDCPool.getTokenB();

    const orcaAmountD = new Decimal(0.1);
    const usdcAmountD = new Decimal(0.1);

    const slippage = new Decimal(5.0);

    const quote1 = await orcaSOLPool.getQuote(solToken, solAmount, slippage);
    const quote2 = await orcaUSDCPool.getQuote(
      orcaToken,
      orcaAmountD,
      slippage,
    );

    const orcaAmount = quote1.getMinOutputAmount();
    const usdcAmount = quote2.getMinOutputAmount();

    console.log(
      `Swap ${solAmount.toString()} SOL for at least ${orcaAmount.toNumber()} ORCA`,
    );
    const swapPayload = await orcaSOLPool.swap(
      this.keypair,
      solToken,
      solAmount,
      orcaAmount,
    );
    const swap1TxId = await swapPayload.execute();
    console.log('Signature:', swap1TxId, '\n');

    console.log(
      `Swap ${orcaAmountD.toString()} ORCA for at least ${usdcAmount.toNumber()} USDC`,
    );
    const swap2Payload = await orcaUSDCPool.swap(
      this.keypair,
      orcaToken,
      usdcAmountD,
      usdcAmount,
    );
    const swap2TxId = await swap2Payload.execute();
    console.log('Signature:', swap2TxId, '\n');

    return {
      txIds: [swap1TxId, swap2TxId],
      inAmount: solAmount.toNumber() * SOL_DECIMAL,
      outAmount: usdcAmount.toNumber() * USDC_DECIMAL,
    } as SwapResult;
  }
```

The `buy` and `sell` methods are quite similar - taking a `size` parameter. In both cases, we start by getting an instance of the Orca SDK with the `getOrca` method, which gives us access to the `getPool` method. From there, we can use the `getTokenB` method to be sure we're passing the correct mint address for the SOL token to the `getQuote` method (keep in mind that `getQuote` is asynchronous and returns a Promise, so we need to `await` the result).
It's important to get a minimum output amount for the quoted swap. So important in fact, there is a specific method to do just that: `getMinOutputAmount` returns the smallest amount of ORCA tokens that the user will recieve for the quoted swap, and in the case that the swap produces less than this amount the transaction will revert. This protects the user from sudden changes in liquidity and slippage. These are advanced topics we won't dive into here, but this particular pattern is quite easy to implement with the Orca SDK. Just remember to program defensively and keep your users in mind 😀.

We can now supply all the necessary parameters to the `swap` method on the Pool instance. The [type definitions](https://github.com/orca-so/typescript-sdk/blob/d231754ef33d21b6a60858996cd93450807f61f3/src/public/pools/types.ts#L91) tell us what we need to know about this method. It will "Perform a swap from the input type to the other token in the pool. Fee for the transaction will be paid by the owner's wallet." The `swap` returns the transaction signature of the swap instruction. This can be sent to the Solana cluster for processing [via the `execute` method from the Orca SDK's `TransactionPayload` type](https://github.com/orca-so/typescript-sdk/blob/d231754ef33d21b6a60858996cd93450807f61f3/src/public/utils/models/instruction.ts#L25).
Both `buy` and `sell` return the same values: The transaction IDs of both swaps to and from ORCA tokens contained in an array, and the amount of tokens in and out.

Let's also break down the `JupiterSwapClient` to understand what's happening on Solana mainnet when an order is executed:

```typescript
// components/protocols/pyth/lib/swap.ts

export class JupiterSwapClient {
  private jupiter: Jupiter;

  constructor(
    jupiter: Jupiter,
    public readonly tokenA: Token,
    public readonly tokenB: Token,
    public readonly keypair: Keypair,
  ) {
    this.jupiter = jupiter;
  }
```

The class constructor defines the `Token` and `Connection` instances as both _public_ and _readonly_. This means we can trust that this data isn't being altered midway through the function. It's a mix of best practices and defensive programming 😉. The `jupiter` instance is set as private in the upper scope.

```typescript
// components/protocols/pyth/lib/swap.ts

  static async initialize(
    connection: Connection,
    cluster: Cluster,
    keypair: Keypair,
    tokenAMintAddress: String, // Token to buy
    tokenBMintAddress: String, // token to sell
  ) {
    const jupiter = await Jupiter.load({connection, cluster, user: keypair});
    const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[cluster])).json(); // Fetch token list from Jupiter API
    const inputToken = tokens.find((t) => t.address == tokenAMintAddress); // Buy token
    const outputToken = tokens.find((t) => t.address == tokenBMintAddress); // Sell token
    console.log('Input token:', inputToken);
    console.log('Output token:', outputToken);
    console.log('Keypair:', keypair);
    console.log(connection, cluster);
    if (!inputToken || !outputToken) {
      throw new Error('Token not found');
    }

    return new JupiterSwapClient(jupiter, inputToken, outputToken, keypair);
  }
```

The `initialize` function sets up the connection to Jupiter using the `load` method from the Jupiter SDK. It also gets the token list for the Solana cluster we're using (mainnet in this case). We've included the console logging so you can take a look at the public keys and inspect the keypair if you want to. We'll return an instance of the `JupiterSwapClient` containing the initialized values.

Next, let's have a look at the `getRoutes` method, which is responsible for determining the best route across multiple DEXes to perform the token swap for the given amount of the `inputToken`. As you can see we're using the `computeRoutes` method from the Jupiter SDK, passing it the token addresses, the input amount in Lamports, a value for slippage and a boolean value for `shouldFetchRoutes`. The best quote is logged at the end, with the entire `routes` object being returned. The `routesInfos` array contans all of the possible routes aggregated by Jupiter. Pretty awesome 😎!

```typescript
// components/protocols/pyth/lib/swap.ts

  async getRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
  }: {
    inputToken?: Token;
    outputToken?: Token;
    inputAmount: number;
    slippage: number;
  }) {
    if (!inputToken || !outputToken) {
      return null;
    }

    console.log('Getting routes');
    const inputAmountLamports = inputToken
      ? Math.round(inputAmount * 10 ** inputToken.decimals)
      : 0; // Lamports based on token decimals
    const routes =
      inputToken && outputToken
        ? await this.jupiter.computeRoutes(
            new PublicKey(inputToken.address),
            new PublicKey(outputToken.address),
            inputAmountLamports,
            slippage,
            true,
          )
        : null;

    if (routes && routes.routesInfos) {
      console.log('Possible number of routes:', routes.routesInfos.length);
      console.log('Best quote: ', routes.routesInfos[0].outAmount);
      return routes;
    } else {
      return null;
    }
  }
```

Next we have the `buy` and `sell` methods which leverage `getRoutes` and then return the value of the `executeSwap` method:

```typescript
// components/protocols/pyth/lib/swap.ts

  // USDC -> SOL
  async buy(size: number) {
    const routes = await this.getRoutes({
      inputToken: this.tokenB, // USDC
      outputToken: this.tokenA, // SOL
      inputAmount: size, // 1 unit in UI
      slippage: 1, // 1% slippage
    });
    console.log('Routes:', routes);
    if (routes?.routesInfos) {
      console.log('Best Route', routes.routesInfos[0]);
      return this.executeSwap(routes?.routesInfos[0]);
    } else {
      throw new Error('Route not found');
    }
  }
  // SOL -> USDC
  async sell(size: number) {
    const routes = await this.getRoutes({
      inputToken: this.tokenA,
      outputToken: this.tokenB,
      inputAmount: size, // 1 unit in UI
      slippage: 1, // 1% slippage
    });
    if (routes?.routesInfos) {
      console.log('Best Route', routes.routesInfos[0]);
      return this.executeSwap(routes?.routesInfos[0]);
    } else {
      throw new Error('Route not found');
    }
  }
```

The `executeSwap` method is the last piece of functionality we need to make our swaps. It's essentially just a wrapper for the Jupiter `exchange` method with some additional logging:

```typescript
// components/protocols/pyth/lib/swap.ts
  async executeSwap(route: RouteInfo) {
    // Prepare execute exchange
    const {execute} = await this.jupiter.exchange({
      route,
    });
    // Execute swap
    const swapResult: any = await execute(); // Force any to ignore TS misidentifying SwapResult type

    if (swapResult.error) {
      console.log(swapResult.error);
      return {...swapResult, txIds: [swapResult.txId]}; // fit the swapResult interface
    } else {
      console.log(`https://explorer.solana.com/tx/${swapResult.txid}`);
      console.log(
        `inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`,
      );
      console.log(
        `inputAmount=${swapResult.inputAmount} outputAmount=${swapResult.outputAmount}`,
      );
    }
    return {
      txIds: [swapResult.txid],
      inAmount: swapResult.inputAmount,
      outAmount: swapResult.outputAmount,
    };
  }
```

---

# 🧪 Testing individual buy and sell orders

We've encapsulated the indvidual buy and sell buttons into their own component, which is included in `components/protocols/pyth/components/Exchange.tsx`. This functional component passes the `Order` object to the `addOrder` function, and has default placeholder values but will accept the updated values based on the inputs thanks to `onChange`.

There is also a dedicated button to swap from SOL to ORCA. This is important because if you attempt swaps without having some extra ORCA tokens, you won't be able to pay the pool fees and there will be an "Insufficient balance" error.

{% hint style="tip" %}
Remember to swap some SOL for ORCA before you start the liquidation bot!
{% endhint %}

```tsx
// components/protocols/pyth/components/Exchange.tsx

const BuySellControllers: React.FC<{addOrder: (order: Order) => void}> = ({
  addOrder,
}) => {
  const [buySize, setBuySize] = useState<number>(0.1);
  const [sellSize, setSellSize] = useState<number>(0.1);
  const [sellInitialSize, setSellInitialSize] = useState<number>(0.1);
  return (
    <Card bordered={false}>
      <Row>
        <Input.Group compact>
          <br />
          <InputNumber
            min={0}
            value={sellSize}
            onChange={(val) => setSellSize(val)}
          />
          <Button
            type="primary"
            onClick={async () =>
              await addOrder({
                side: 'sell',
                size: sellSize,
                fromToken: 'SOL',
                toToken: 'ORCA',
              })
            }
          >
            SOL -&gt; ORCA
          </Button>
        </Input.Group>
        <Col span={8}>
          <br />
          <Input.Group compact>
            <InputNumber
              min={0}
              value={sellSize}
              onChange={(val) => setSellSize(val)}
            />
            <Button
              type="primary"
              onClick={async () =>
                await addOrder({
                  side: 'sell',
                  size: sellSize,
                  fromToken: 'SOL',
                  toToken: 'USDC',
                })
              }
            >
              sell
            </Button>
          </Input.Group>
        </Col>
        <br />
        <br />
        <Col span={8}>
          <br />
          <Input.Group compact>
            <InputNumber
              min={0}
              value={buySize}
              onChange={(val) => setBuySize(val)}
            />
            <Button
              type="primary"
              onClick={async () =>
                await addOrder({
                  side: 'buy',
                  size: buySize,
                  fromToken: 'USDC',
                  toToken: 'SOL',
                })
              }
            >
              buy
            </Button>
          </Input.Group>
        </Col>
      </Row>
    </Card>
  );
};
```

# 📖 The order book

The order book is necessary to keep track of the buy and sell orders we're going to be generating. When the liquidation bot is running, orders will be happening frequently. Luckily for us, antd has a flexible table component with built in pagination so we don't even need to program that part ourselves.

Before doing this on devnet, give it a try using the mock wallet! You'll be able to see the details of an order:

- The Transactions column will contain links to view the actual swap transactions on the [solscan.io](https://solscan.io) block explorer
- "Side" indicates whether the order was a buy or sell
- You can easily interpret the outgoing and incoming tokens and amounts

<<<<<<< Updated upstream
![Mock Order](https://raw.githubusercontent.com/figment-networks/learn-web3-dapp/main/markdown/__images__/pyth/mock_orderbook.png)
=======
![The Order Book](https://raw.githubusercontent.com/figment-networks/learn-web3-dapp/main/markdown/__images__/pyth/order_book.png?raw=true)

You might notice there's a discrepancy in the devnet token values. This is unfortunately beyond our control. The mock swaps and mainnet swaps use the true values from Jupiter.

> > > > > > > Stashed changes

Let's take a quick look at the Table in the return value of `components/protocols/pyth/components/Exchange.tsx` to better understand how the order book is being rendered. The antd Table component takes an _array of objects_ for the `columns`, each of these objects has a `title`, `dataIndex` and `key` - optionally we can use the `render` method to add whatever additional React fragments we need, for example: Mapping the transaction IDs to a link pointing to the correct page on solscan.io, or changing the color of the tags we use to display the amounts.

{% hint style="info" %}
Remember to wrap the return values here in [React fragments](https://reactjs.org/docs/fragments.html) (`<> </>`) to avoid trouble with rendering, since they're being rendered within an existing `<div>`!
{% endhint %}

```tsx
// components/protocols/pyth/components/Exchange.tsx

<Table
  dataSource={orderBook}
  columns={[
    {
      title: 'Transactions',
      dataIndex: 'txIds',
      key: 'txIds',
      render: (txIds) => {
        return (
          <>
            {txIds.map((txId: string) => (
              <a
                href={`https://solscan.io/tx/${txId}?cluster=${cluster}`}
                key={txId}
                target={'_blank'}
                rel="noreferrer"
              >
                {txId?.substring(-1, 5)}
              </a>
            ))}
          </>
        );
      },
    },
    {
      title: 'Side',
      dataIndex: 'side',
      key: 'side',
    },
    {
      title: 'out Amount',
      dataIndex: 'inAmount',
      key: 'inAmount',
      render: (val, order) => {
        if (order.side === 'buy') {
          return <Tag color="red">{val / USDC_DECIMAL}</Tag>;
        } else {
          return <Tag color="green">{val / SOL_DECIMAL}</Tag>;
        }
      },
    },
    {
      title: 'Out Token',
      dataIndex: 'fromToken',
      key: 'fromToken',
    },
    {
      title: 'in Amount',
      dataIndex: 'outAmount',
      key: 'outAmount',
      render: (val, order) => {
        if (order.side === 'buy') {
          return <Tag color="red">{val / SOL_DECIMAL}</Tag>;
        } else {
          return <Tag color="green">{val / USDC_DECIMAL}</Tag>;
        }
      },
    },
    {
      title: 'In Token',
      dataIndex: 'toToken',
      key: 'toToken',
    },
  ]}
></Table>
```

---

# 🏋️ Challenge

{% hint style="tip" %}
In `components/protocols/pyth/components/Exchange.tsx`, finish implementing the RxJS `map` to determine what happens when a buy or sell signal is resolved. You must replace the instances of `undefined` to accomplish this.
{% endhint %}

**Take a few minutes to figure this out**

```typescript
//...
        Rx.map((val: number) => {
          if (val > 0) {
            // buy.
            return {undefined};
          } else if (val <= 0) {
            return {undefined};
          }
        }),
//...
```

**Need some help?** Check out these hints 👇

- Remember the `Order` object and its properties. This is what you'll need to return here
- You'll definitely want to sell SOL for USDC and buy SOL with USDC
- It's important to multiply your values by the order size

Still not sure how to do this? No problem! The solution is below so you don't get stuck.

---

# 😅 Solution

```typescript
// solution
//...
        Rx.map((val: number) => {
          if (val > 0) {
            return {
              side: 'buy',
              size: val * orderSizeUSDC,
              fromToken: 'usdc',
              toToken: 'sol',
            };
          } else if (val <= 0) {
            return {
              side: 'sell',
              size: Math.abs(val) * orderSizeSOL,
              fromToken: 'sol',
              toToken: 'usdc',
            };
          }
        }),
//...
```

**What happened in the code above?**

- We use RxJS to `map` the numerical value being passed, then return an `Order` object with the appropriate values set in its properties.
- The property names need to match the `Order` object, `side`, `size`, `fromToken` & `toToken`.

---

# ✅ Make sure it works

## 🐢 Mock swaps

If you're going to use the **mock wallet**, then all you need to do is specify an amount to buy or sell into the input next to the button and click on the **buy** or **sell** button. This will generate a mock transaction, which is _not_ sent to the Solana cluster. You can still view the order details on the order book component, however the Transaction link to the block explorer will not work.

## 🐇 Actual swaps

Once you've made the necessary changes to `components/protocols/pyth/components/Exchange.tsx` and saved the file, the Next.js development server will hot module reload the page automatically. Once the page is reloaded, you can switch the wallet over to **live**. Clicking on the "sell" and "buy" buttons will send an order of each type on devnet. If you're feeling brave (and if you have actual SOL in your wallet) you might try a swap on mainnet.

---

# 🏁 Conclusion

We learned about Associated Token Accounts and SPL tokens like Wrapped SOL. We also looked at how to use the Orca and Jupiter SDKs by creating functions for exchanging SPL tokens. Using RxJS, we can save a lot of hassle in how we perform the swaps, using a defined "order book" to hold and process the swaps.