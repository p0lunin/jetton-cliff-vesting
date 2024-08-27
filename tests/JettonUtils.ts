import { JettonMinter } from '../wrappers/jettons/JettonMinter';
import { beginCell, Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { compile } from '@ton/blueprint';

export async function deployJettonMinter(
    blockchain: Blockchain,
    deployer: SandboxContract<TreasuryContract>,
    content?: Cell,
) {
    const jettonMinter = blockchain.openContract(
        JettonMinter.createFromConfig(
            {
                admin: deployer.address,
                content: content || beginCell().endCell(),
                wallet_code: await compile('jettons/JettonWallet'),
            },
            await compile('jettons/JettonMinter'),
        ),
    );

    const minterDeployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('1'));
    expect(minterDeployResult.transactions).toHaveTransaction({
        from: deployer.address,
        to: jettonMinter.address,
        deploy: true,
        success: true,
    });

    return jettonMinter;
}
