import { toNano } from '@ton/core';
import { Vesting } from '../wrappers/Vesting';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const vesting = provider.open(Vesting.createFromConfig({}, await compile('Vesting')));

    await vesting.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(vesting.address);

    // run methods on `vesting`
}
