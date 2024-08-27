import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { Vesting } from '../wrappers/Vesting';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/jettons/JettonMinter';
import { JettonWallet } from '../wrappers/jettons/JettonWallet';
import { deployJettonMinter } from './JettonUtils';

const ONE_MONTH = 60 * 60 * 24 * 30;
const ONE_YEAR = ONE_MONTH * 12;

describe('Vesting', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Vesting');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let vesting: SandboxContract<Vesting>;

    let jettonMinter: SandboxContract<JettonMinter>;
    let vestingJettonWallet: SandboxContract<JettonWallet>;

    let base_time = Math.floor(Date.now() / 1000);

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        jettonMinter = await deployJettonMinter(blockchain, deployer);

        vesting = blockchain.openContract(
            Vesting.createFromConfig(
                {
                    jettonReceiver: deployer.address,
                    startDate: base_time,
                    cliffDate: base_time + ONE_YEAR,
                    vestingStep: ONE_YEAR / 4, // 3 months
                    vestingAmount: toNano('10'),
                },
                code,
            ),
        );

        const deployResult = await vesting.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
            await jettonMinter.getWalletAddress(vesting.address),
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and vesting are ready to use

        const data = await vesting.getData();

        expect(data.contractJettonWallet).toEqualAddress(await jettonMinter.getWalletAddress(vesting.address));
        expect(data.jettonReceiver).toEqualAddress(deployer.address);
        expect(data.startDate).toEqual(base_time);
        expect(data.cliffDate).toEqual(base_time + 60 * 60 * 24 * 30 * 12);
        expect(data.vestingStep).toEqual(60 * 60 * 24 * 30 * 3);
        expect(data.vestingAmount).toEqual(toNano('10'));
        expect(data.lockedBalance).toEqual(0n);
        expect(data.withdrawnBalance).toEqual(0n);
    });

    it('should not deploy if wrong jettonReceiver', async () => {
        const vesting2 = blockchain.openContract(
            Vesting.createFromConfig(
                {
                    jettonReceiver: deployer.address,
                    startDate: base_time,
                    cliffDate: base_time + ONE_YEAR,
                    vestingStep: ONE_YEAR / 4, // 3 months
                    vestingAmount: toNano('10'),
                },
                code,
            ),
        );

        const someoneElse = await blockchain.treasury('someoneElse');
        const deployResult = await vesting2.sendDeploy(
            someoneElse.getSender(),
            toNano('0.05'),
            await jettonMinter.getWalletAddress(vesting2.address),
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: someoneElse.address,
            to: vesting2.address,
            success: false,
            exitCode: 700,
        });
    });

    it('should bounce init if already inited', async () => {
        const deployResult = await vesting.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
            await jettonMinter.getWalletAddress(vesting.address),
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: false,
            exitCode: 703,
        });
    });

    it('should fill up the balance', async () => {
        const res = await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        const vestingJettonWalletAddress = await jettonMinter.getWalletAddress(vesting.address);

        expect(res.transactions).toHaveTransaction({
            from: vestingJettonWalletAddress,
            to: vesting.address,
            success: true,
        });

        const data = await vesting.getData();

        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(0n);
    });

    it('should send back wrong jettons', async () => {
        const wrongJettonMinter = await deployJettonMinter(
            blockchain,
            deployer,
            beginCell().storeUint(1, 32).endCell(),
        );
        await wrongJettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        const deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await wrongJettonMinter.getWalletAddress(deployer.address)),
        );

        let res = await deployerJettonWallet.sendTransfer(
            deployer.getSender(),
            toNano('0.3'),
            toNano('100'),
            vesting.address,
            deployer.address,
            beginCell().endCell(),
            toNano('0.25'),
            beginCell().endCell(),
        );

        const vestingWrongJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await wrongJettonMinter.getWalletAddress(vesting.address)),
        );
        expect(await vestingWrongJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        expect(res.transactions).toHaveTransaction({
            from: vestingWrongJettonWallet.address,
            to: vesting.address,
            success: true,
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(toNano('100'));
    });

    it('should withdraw after cliff', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        blockchain.now = base_time + 60 * 60 * 24 * 30 * 12 + 1;

        const res = await vesting.sendWithdraw(deployer.getSender(), {});

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: true,
        });

        const data = await vesting.getData();

        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(toNano('40'));

        const deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployer.address)),
        );

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(toNano('40'));
    });

    it('should not withdraw if wrong sender', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        blockchain.now = base_time + 60 * 60 * 24 * 30 * 12 + 1;

        const someoneElse = await blockchain.treasury('someoneElse');
        const res = await vesting.sendWithdraw(someoneElse.getSender(), {});

        expect(res.transactions).toHaveTransaction({
            from: someoneElse.address,
            to: vesting.address,
            success: false,
            exitCode: 700,
        });

        const data = await vesting.getData();

        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(0n);
    });

    it('should not withdraw if not cliff yet', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        blockchain.now = base_time + 60 * 60 * 24 * 30 * 12 - 1;

        const res = await vesting.sendWithdraw(deployer.getSender(), {});

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: false,
            exitCode: 701,
        });

        const data = await vesting.getData();

        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(0n);
    });

    it('should not withdraw if already withdrawn', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        blockchain.now = base_time + ONE_YEAR * 3;

        await vesting.sendWithdraw(deployer.getSender(), {});

        const res = await vesting.sendWithdraw(deployer.getSender(), {});

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: false,
            exitCode: 702,
        });

        const data = await vesting.getData();

        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(toNano('100'));
    });

    it('should not withdraw if half of vesting period passed', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        blockchain.now = base_time + ONE_YEAR;
        await vesting.sendWithdraw(deployer.getSender(), {});

        const data1 = await vesting.getData();
        expect(data1.lockedBalance).toEqual(toNano('100'));
        expect(data1.withdrawnBalance).toEqual(toNano('40'));

        // WITHDRAW 2
        blockchain.now = base_time + ONE_YEAR + ONE_MONTH * 2;
        const res = await vesting.sendWithdraw(deployer.getSender(), {});

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: true,
        });

        const data = await vesting.getData();
        expect(data.lockedBalance).toEqual(toNano('100'));
        expect(data.withdrawnBalance).toEqual(toNano('40'));

        const deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployer.address)),
        );
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(toNano('40'));
    });

    it('should withdraw sequentially', async () => {
        await jettonMinter.sendMint(
            deployer.getSender(),
            vesting.address,
            toNano('100'),
            toNano('0.25'),
            toNano('0.35'),
        );

        const deployerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(deployer.address)),
        );

        let test = async (add_time: number, withdrawnBalance: bigint) => {
            blockchain.now = base_time + add_time;
            await vesting.sendWithdraw(deployer.getSender(), {});

            const data1 = await vesting.getData();
            expect(data1.lockedBalance).toEqual(toNano('100'));
            expect(data1.withdrawnBalance).toEqual(withdrawnBalance);
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(withdrawnBalance);
        };

        await test(ONE_YEAR, toNano('40'));
        await test(ONE_YEAR + ONE_MONTH * 3, toNano('50'));
        await test(ONE_YEAR + ONE_MONTH * 9, toNano('70'));
    });

    it('should transfer ownership', async () => {
        const someoneElse = await blockchain.treasury('someoneElse');
        const res = await vesting.sendTransfer(deployer.getSender(), { to: someoneElse.address });

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: true,
        });

        const data = await vesting.getData();
        expect(data.jettonReceiver).toEqualAddress(someoneElse.address);
    });

    it('should not transfer ownership if not owner', async () => {
        const someoneElse = await blockchain.treasury('someoneElse');
        const res = await vesting.sendTransfer(someoneElse.getSender(), { to: someoneElse.address });

        expect(res.transactions).toHaveTransaction({
            from: someoneElse.address,
            to: vesting.address,
            success: false,
            exitCode: 700,
        });

        const data = await vesting.getData();
        expect(data.jettonReceiver).toEqualAddress(deployer.address);
    });

    it('should send emergency message', async () => {
        const receiver = await blockchain.treasury('receiver');
        const message = beginCell()
            .storeUint(0x18, 6)
            .storeAddress(receiver.address)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell();
        const res = await vesting.sendEmergency(deployer.getSender(), {
            value: toNano('0.1'),
            message,
            mode: 64,
        });

        expect(res.transactions).toHaveTransaction({
            from: vesting.address,
            to: receiver.address,
            success: true,
        });
    });

    it('should not send emergency message if not owner', async () => {
        const someoneElse = await blockchain.treasury('someoneElse');
        const receiver = await blockchain.treasury('receiver');
        const message = beginCell()
            .storeUint(0x18, 6)
            .storeAddress(receiver.address)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell();
        const res = await vesting.sendEmergency(someoneElse.getSender(), {
            value: toNano('0.1'),
            message,
            mode: 64,
        });

        expect(res.transactions).toHaveTransaction({
            from: someoneElse.address,
            to: vesting.address,
            success: false,
            exitCode: 700,
        });
    });

    it('should not send emergency message if receiver is jetton wallet', async () => {
        const receiver = await jettonMinter.getWalletAddress(vesting.address);
        const message = beginCell()
            .storeUint(0x18, 6)
            .storeAddress(receiver)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell();
        const res = await vesting.sendEmergency(deployer.getSender(), {
            value: toNano('0.1'),
            message,
            mode: 64,
        });

        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: vesting.address,
            success: false,
            exitCode: 801,
        });
    });
});
