export type FAQCategory = 'getting-started' | 'stellar-specifics' | 'privacy' | 'troubleshooting';
export type FAQContext = 'send' | 'receive' | 'general';

export interface FAQEntry {
  id: string;
  category: FAQCategory;
  context: FAQContext[];
  question: string;
  answer: string;
  docsLink?: string;
}

export const faqEntries: FAQEntry[] = [
  // Getting started
  {
    id: 'what-is-stealth-address',
    category: 'getting-started',
    context: ['send', 'receive', 'general'],
    question: 'What is a stealth address?',
    answer: 'A stealth address is a one-time payment destination that hides the recipient\'s identity on the blockchain. When someone sends funds to a stealth address, only the recipient can detect and spend the funds, even though the transaction is publicly visible. This is achieved through cryptographic techniques that allow the recipient to scan the blockchain for payments meant for them without revealing their public address to the sender.',
    docsLink: 'https://docs.wraith-protocol.org/concepts/stealth-addresses'
  },
  {
    id: 'why-sign-message',
    category: 'getting-started',
    context: ['send', 'receive', 'general'],
    question: 'Why do I need to sign a message?',
    answer: 'Message signing proves ownership of your wallet without exposing your private key. When you sign a message in the Wraith demo, you\'re authorizing the application to generate stealth addresses on your behalf. This is a standard security practice in Web3 that allows dApps to interact with your wallet safely. The signature doesn\'t give the app access to your funds or allow it to sign transactions.',
    docsLink: 'https://docs.wraith-protocol.org/guides/message-signing'
  },
  {
    id: 'why-freighter-albedo',
    category: 'getting-started',
    context: ['send', 'receive', 'general'],
    question: 'Why Freighter / Albedo?',
    answer: 'Freighter and Albedo are the most widely used and secure wallets for the Stellar network. They provide excellent support for Stellar\'s features and have been audited for security. Freighter is a browser extension that integrates seamlessly with your browser, while Albedo is a web-based wallet that works without installation. Both wallets support the message signing required for stealth address generation.',
    docsLink: 'https://docs.wraith-protocol.org/guides/wallets'
  },
  // Stellar specifics
  {
    id: 'what-is-wraith-name',
    category: 'stellar-specifics',
    context: ['send', 'receive', 'general'],
    question: 'What\'s a .wraith name on Stellar?',
    answer: 'A .wraith name is a human-readable identifier on the Stellar network that can be associated with stealth addresses. Similar to how .stellar names work, .wraith names allow you to send payments to memorable names instead of long cryptographic addresses. When you send to a .wraith name, the system resolves it to the recipient\'s stealth address automatically, making the process more user-friendly while maintaining privacy.',
    docsLink: 'https://docs.wraith-protocol.org/stellar/wraith-names'
  },
  {
    id: 'minimum-balance',
    category: 'stellar-specifics',
    context: ['send', 'general'],
    question: 'Why can\'t I send under 0.001 XLM?',
    answer: 'Stellar has a minimum balance requirement of 0.5 XLM per account to prevent spam and ensure network security. Additionally, there\'s a minimum transaction fee of 0.00001 XLM. The 0.001 XLM limit in the demo accounts for both the base reserve and transaction fees, ensuring your transaction won\'t fail due to insufficient funds. This is a network-level constraint, not a limitation of the Wraith protocol.',
    docsLink: 'https://docs.stellar.org/learn/encyclopedia/fees'
  },
  {
    id: 'base-reserve',
    category: 'stellar-specifics',
    context: ['send', 'receive', 'general'],
    question: 'What\'s a base reserve?',
    answer: 'The base reserve is the minimum amount of XLM that must be held in each Stellar account. Currently set at 0.5 XLM, this reserve exists to prevent network spam by requiring each account to maintain a minimum balance. When you create entries in your account (like trustlines or signers), each additional entry increases your reserve requirement. The base reserve is why you can\'t empty a Stellar account completely.',
    docsLink: 'https://docs.stellar.org/learn/encyclopedia/fees#base-reserve'
  },
  // Privacy
  {
    id: 'is-actually-private',
    category: 'privacy',
    context: ['send', 'receive', 'general'],
    question: 'Is this actually private?',
    answer: 'Wraith provides strong privacy through stealth addresses, which hide the link between sender and recipient on the blockchain. However, privacy is not absolute. The transaction amounts and timestamps are still visible, and metadata can leak through other channels. For maximum privacy, use Wraith in combination with other privacy practices like avoiding address reuse and being mindful of when you reveal your stealth address.',
    docsLink: 'https://docs.wraith-protocol.org/privacy/overview'
  },
  {
    id: 'does-wraith-see-payments',
    category: 'privacy',
    context: ['send', 'receive', 'general'],
    question: 'Does Wraith see my payments?',
    answer: 'The Wraith demo client runs entirely in your browser and does not send transaction data to any backend server. All cryptographic operations happen locally on your device. However, the Stellar network itself is public, so anyone (including the Wraith Protocol team) could theoretically analyze the blockchain. The demo specifically does not log or store any information about your transactions.',
    docsLink: 'https://docs.wraith-protocol.org/privacy/data-handling'
  },
  {
    id: 'what-does-demo-log',
    category: 'privacy',
    context: ['send', 'receive', 'general'],
    question: 'What does the demo log?',
    answer: 'The Wraith demo does not log any personal information, transaction details, or wallet addresses. The only data collected is anonymous usage metrics for improving the user experience. These metrics include page views, button clicks, and error rates, but nothing that could identify you or your transactions. No blockchain data is sent to any server—all interactions happen directly between your wallet and the Stellar network.',
    docsLink: 'https://docs.wraith-protocol.org/privacy/demo-logging'
  },
  // Troubleshooting
  {
    id: 'scan-no-results',
    category: 'troubleshooting',
    context: ['receive', 'general'],
    question: 'Scan returned no results — why?',
    answer: 'If scanning returns no results, it could mean no payments have been sent to your stealth address yet, or the payments were sent very recently and haven\'t been confirmed by the network. Stellar transactions typically take 3-5 seconds to confirm. Make sure you\'re scanning the correct stealth address and that your wallet is properly connected. If the issue persists, try refreshing the page and reconnecting your wallet.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/scanning'
  },
  {
    id: 'withdraw-failed',
    category: 'troubleshooting',
    context: ['send', 'general'],
    question: 'Withdraw failed — why?',
    answer: 'Withdrawal failures can occur for several reasons: insufficient account balance (remember the 0.5 XLM base reserve), network congestion, or an issue with your wallet connection. Make sure you have enough XLM to cover both the withdrawal amount and transaction fees. If using Freighter, ensure the extension is unlocked and you\'ve approved the transaction in the popup.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/withdrawals'
  },
  {
    id: 'lost-stealth-key',
    category: 'troubleshooting',
    context: ['receive', 'general'],
    question: 'I lost my stealth key — what now?',
    answer: 'Your stealth key is derived from your wallet\'s private key, so as long as you still have access to your wallet, you can regenerate your stealth addresses. Simply reconnect your wallet to the demo, and it will generate the same stealth addresses as before. If you\'ve lost access to your wallet entirely (private key or seed phrase), then unfortunately the funds sent to your stealth addresses are irrecoverable—this is the trade-off of non-custodial privacy.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/lost-keys'
  },
  {
    id: 'wallet-not-connecting',
    category: 'troubleshooting',
    context: ['send', 'receive', 'general'],
    question: 'Wallet won\'t connect — what now?',
    answer: 'If your wallet won\'t connect, try these steps: 1) Ensure you\'re using a supported browser (Chrome, Firefox, Brave, or Edge), 2) Check that your wallet extension is enabled and unlocked, 3) Refresh the page and try connecting again, 4) If using Freighter, make sure you\'re on the latest version. For Albedo, ensure pop-ups are allowed in your browser settings. If issues persist, try a different wallet to isolate the problem.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/wallet-connection'
  },
  {
    id: 'transaction-stuck',
    category: 'troubleshooting',
    context: ['send', 'general'],
    question: 'Transaction is stuck — what now?',
    answer: 'Stellar transactions can sometimes appear stuck if network congestion is high or if the transaction fee was too low. Most transactions confirm within 5 seconds, but during peak times it may take longer. Check the transaction status on a Stellar explorer like StellarExpert. If it\'s been more than a minute, the transaction may have failed—try again with a slightly higher fee or wait for network congestion to subside.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/stuck-transactions'
  },
  {
    id: 'wrong-address',
    category: 'troubleshooting',
    context: ['send', 'general'],
    question: 'I sent to the wrong address — can I recover it?',
    answer: 'Unfortunately, once a transaction is confirmed on the Stellar network, it cannot be reversed. This is a fundamental property of blockchain technology. If you sent to the wrong stealth address, the recipient (whoever controls that address) can claim the funds. Always double-check addresses before sending, and consider sending a small test amount first for larger transactions. This is why stealth addresses are designed to be one-time use—mistakes are isolated to single transactions.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/wrong-address'
  },
  {
    id: 'fee-too-high',
    category: 'troubleshooting',
    context: ['send', 'general'],
    question: 'Why are the fees so high?',
    answer: 'Stellar\'s fees are actually very low compared to other blockchains—typically just 0.00001 XLM per operation. If fees seem high, it may be because you\'re performing multiple operations in a single transaction (like creating a trustline and sending a payment). The demo shows you the total fee before you confirm. These fees go to the Stellar network to prevent spam and maintain security, not to Wraith Protocol.',
    docsLink: 'https://docs.wraith-protocol.org/troubleshooting/fees'
  }
];

export const categoryLabels: Record<FAQCategory, string> = {
  'getting-started': 'Getting Started',
  'stellar-specifics': 'Stellar Specifics',
  'privacy': 'Privacy',
  'troubleshooting': 'Troubleshooting'
};

export const contextLabels: Record<FAQContext, string> = {
  'send': 'Sending',
  'receive': 'Receiving',
  'general': 'General'
};
