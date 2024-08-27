import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    targets: [
        'contracts/imports/stdlib.fc',
        'contracts/jettons/params.fc',
        'contracts/jettons/op-codes.fc',
        'contracts/jettons/jetton-utils.fc',
        'contracts/jettons/jetton_minter.fc',
    ],
};
