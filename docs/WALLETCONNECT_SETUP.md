# WalletConnect v2 Setup Guide

This guide explains how to configure WalletConnect v2 for Stellar wallets in the Wraith Protocol demo.

## Prerequisites

To use WalletConnect, you need a WalletConnect Project ID. This is required to initialize the WalletConnect client.

## Getting a WalletConnect Project ID

1. Go to [WalletConnect Cloud](https://cloud.walletconnect.com/)
2. Sign up or log in
3. Create a new project
4. Copy your Project ID

## Configuration

Add the Project ID to your environment:

```bash
# For local development
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

### Option 1: `.env` file (local development)

Create a `.env` file in the project root:

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

### Option 2: Deployment platforms

#### Vercel
Add as an environment variable in your Vercel project settings:
- Name: `VITE_WALLETCONNECT_PROJECT_ID`
- Value: Your Project ID

#### Other platforms
Add `VITE_WALLETCONNECT_PROJECT_ID` as an environment variable in your deployment configuration.

## Supported Wallets

WalletConnect v2 enables connections to any WalletConnect-compatible Stellar wallet, including:

- **LOBSTR** - Mobile wallet with WalletConnect support
- **xBull** - Mobile wallet with WalletConnect support
- **Other WC-compatible wallets** - Any wallet implementing the WalletConnect Stellar protocol

## How It Works

1. User selects "WalletConnect" from the wallet picker
2. A QR code is displayed
3. User scans the QR code with their mobile wallet app
4. Wallet approves the connection
5. The dapp can now request transaction signatures

## Testing

To test WalletConnect integration:

1. Set up your WalletConnect Project ID
2. Start the development server: `pnpm dev`
3. Navigate to the Stellar chain
4. Click "Connect Wallet"
5. Select "WalletConnect"
6. Scan the QR code with a WalletConnect-compatible mobile wallet (e.g., LOBSTR)
7. Approve the connection in your mobile wallet

## Troubleshooting

### "WalletConnect project ID not configured"
- Ensure `VITE_WALLETCONNECT_PROJECT_ID` is set in your environment
- Restart your development server after adding the environment variable

### QR code not displaying
- Check browser console for errors
- Verify the WalletConnect client initialized successfully
- Ensure your Project ID is valid

### Connection fails
- Ensure your mobile wallet supports WalletConnect v2
- Check that your mobile wallet supports Stellar
- Verify you're on the correct network (testnet/mainnet)

## Adding More WalletConnect-Compatible Wallets

To add support for additional WalletConnect-compatible wallets:

1. The WalletConnect adapter already supports any WC-compatible wallet
2. No code changes needed - wallets are discovered through the WalletConnect protocol
3. Users can connect any wallet that:
   - Implements WalletConnect v2
   - Supports the Stellar blockchain
   - Implements the `stellar_signAndSubmitXDR` method

For wallet-specific configuration or branding, you can extend the `WalletConnectAdapter` class to add custom metadata or behavior.
