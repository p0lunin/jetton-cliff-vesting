import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';

export type VestingConfig = {
    jettonReceiver: Address;
    startDate: number;
    cliffDate: number;
    vestingStep: number;
    vestingAmount: bigint;
};

export function vestingConfigToCell(config: VestingConfig): Cell {
    return beginCell()
        .storeAddress(null)
        .storeAddress(config.jettonReceiver)
        .storeUint(config.startDate, 64)
        .storeCoins(0) // lockedBalance
        .storeCoins(0) // withdrawnBalance
        .storeRef(
            beginCell()
                .storeUint(config.cliffDate, 64)
                .storeUint(config.vestingStep, 64)
                .storeCoins(config.vestingAmount),
        )
        .endCell();
}

enum OpCode {
    INIT = 0,
    WITHDRAW = 1,
    EMERGENCY = 2,
    TRANSFER = 0x5fcc3d14,
}

export class Vesting implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Vesting(address);
    }

    static createFromConfig(config: VestingConfig, code: Cell, workchain = 0) {
        const data = vestingConfigToCell(config);
        const init = { code, data };
        return new Vesting(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint, contractJettonWallet: Address) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OpCode.INIT, 32)
                .storeUint(0x00, 64)
                .storeAddress(contractJettonWallet)
                .endCell(),
        });
    }

    async sendWithdraw(provider: ContractProvider, via: Sender, opts: { query_id?: number }) {
        await provider.internal(via, {
            value: toNano('1.0'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OpCode.WITHDRAW, 32)
                .storeUint(opts.query_id || 0, 64)
                .endCell(),
        });
    }

    async sendEmergency(
        provider: ContractProvider,
        via: Sender,
        opts: { query_id?: number; value: bigint; message: Cell; mode: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OpCode.EMERGENCY, 32)
                .storeUint(opts.query_id || 0, 64)
                .storeRef(opts.message)
                .storeUint(opts.mode, 8)
                .endCell(),
        });
    }

    async sendTransfer(provider: ContractProvider, via: Sender, opts: { query_id?: number; to: Address }) {
        await provider.internal(via, {
            value: toNano('1.0'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OpCode.TRANSFER, 32)
                .storeUint(opts.query_id || 0, 64)
                .storeAddress(opts.to)
                .endCell(),
        });
    }

    async getData(provider: ContractProvider): Promise<VestingState> {
        const data = (await provider.get('get_vesting_data', [])).stack;
        return {
            contractJettonWallet: data.readAddress(),
            jettonReceiver: data.readAddress(),
            startDate: data.readNumber(),
            lockedBalance: data.readBigNumber(),
            withdrawnBalance: data.readBigNumber(),
            cliffDate: data.readNumber(),
            vestingStep: data.readNumber(),
            vestingAmount: data.readBigNumber(),
        };
    }
}

export type VestingState = {
    contractJettonWallet: Address;
    jettonReceiver: Address;
    startDate: number;
    lockedBalance: bigint;
    withdrawnBalance: bigint;
    cliffDate: number;
    vestingStep: number;
    vestingAmount: bigint;
};
