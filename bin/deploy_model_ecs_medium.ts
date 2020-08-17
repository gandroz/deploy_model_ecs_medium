#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { Archi, DeployModelEcsMediumStack, DeployModelEcsMediumStackCore } from '../lib/deploy_model_ecs_medium-stack';

const app = new cdk.App();

const MediumArticleCore = new DeployModelEcsMediumStackCore(app, 'MediumArticleCoreCdkStack', {
    vpc: undefined,
    env: { 
        account: process.env.CDK_DEFAULT_ACCOUNT, 
        region: process.env.CDK_DEFAULT_REGION 
    }
});

const MediumArticleVersion = "1.0.0"

for(let archi in Archi){
    new DeployModelEcsMediumStack(app, `MediumArticle${archi}CdkStack`, {
        vpc: MediumArticleCore.MediumArticleVpc,
        cluster: MediumArticleCore.cluster,
        sg: MediumArticleCore.sg,
        MediumArticleTaskRole: MediumArticleCore.MediumArticleTaskRole,
        archi: Archi[archi as keyof typeof Archi],
        MediumArticleVersion: MediumArticleVersion,
        env: { 
            account: process.env.CDK_DEFAULT_ACCOUNT, 
            region: process.env.CDK_DEFAULT_REGION 
        }
    });
}