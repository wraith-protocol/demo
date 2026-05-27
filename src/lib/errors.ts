export interface ContractErrorDef {
  code: number;
  name: string;
  message: string;
}

type ErrorRegistry = Record<string, Record<number, ContractErrorDef>>;

const registry: ErrorRegistry = {
  CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL: {
    1: {
      code: 1,
      name: 'AlreadyAnnounced',
      message: 'This stealth address has already been announced.',
    },
    2: {
      code: 2,
      name: 'InvalidStealthAddress',
      message: 'The stealth address is invalid or malformed.',
    },
    3: {
      code: 3,
      name: 'InvalidScheme',
      message: 'Unsupported stealth address scheme.',
    },
    4: {
      code: 4,
      name: 'Unauthorized',
      message: 'Caller is not authorized to announce.',
    },
  },
  CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5: {
    1: {
      code: 1,
      name: 'AlreadyRegistered',
      message: 'This meta-address is already registered on-chain.',
    },
    2: {
      code: 2,
      name: 'InvalidMetaAddress',
      message: 'The meta-address is invalid or has incorrect length.',
    },
    3: {
      code: 3,
      name: 'InvalidScheme',
      message: 'Unsupported stealth address scheme.',
    },
    4: {
      code: 4,
      name: 'Unauthorized',
      message: 'Caller is not authorized to register keys.',
    },
  },
};

export function decodeContractError(contractAddress: string, errorString: string): string | null {
  const contractErrors = registry[contractAddress];
  if (!contractErrors) return null;

  const codeMatch = errorString.match(/ContractError\((\d+)\)/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    const def = contractErrors[code];
    if (def) return `${def.name}: ${def.message}`;
  }

  for (const def of Object.values(contractErrors)) {
    if (errorString.includes(def.name)) {
      return `${def.name}: ${def.message}`;
    }
  }

  return null;
}

export function decodeSimulationError(errorString: string, contractAddress?: string): string {
  if (contractAddress) {
    const decoded = decodeContractError(contractAddress, errorString);
    if (decoded) return decoded;
  }

  if (errorString.includes('InsufficientBalance') || errorString.includes('insufficient_balance')) {
    return 'Insufficient balance to complete this transaction.';
  }
  if (errorString.includes('AccountNotFound') || errorString.includes('account_not_found')) {
    return 'Account not found on the network.';
  }
  if (errorString.includes('ResourceLimitExceeded')) {
    return 'Transaction exceeds resource limits. Try reducing the operation complexity.';
  }

  return errorString;
}

export function registerContractErrors(
  contractAddress: string,
  errors: Record<number, ContractErrorDef>,
) {
  registry[contractAddress] = errors;
}
