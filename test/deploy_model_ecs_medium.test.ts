import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as DeployModelEcsMedium from '../lib/deploy_model_ecs_medium-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new DeployModelEcsMedium.DeployModelEcsMediumStackCore(app, 'MyTestStack', {
      vpc: undefined,
      env: { 
          account: process.env.CDK_DEFAULT_ACCOUNT, 
          region: process.env.CDK_DEFAULT_REGION 
      }
    });

    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
