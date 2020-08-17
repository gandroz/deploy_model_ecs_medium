import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambda_event_source from '@aws-cdk/aws-lambda-event-sources';
import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import * as appautoscaling from '@aws-cdk/aws-applicationautoscaling';
import * as autoscaling from '@aws-cdk/aws-autoscaling';
import * as cw from '@aws-cdk/aws-cloudwatch';
import * as cwactions from '@aws-cdk/aws-cloudwatch-actions';
import * as sqs from '@aws-cdk/aws-sqs';


export enum Archi {
  Cpu = "CPU",
  Gpu = "GPU",
}


interface DeployModelEcsMediumStackCoreProps extends cdk.StackProps {
  vpc: ec2.IVpc | undefined,
}


interface DeployModelEcsMediumStackProps extends cdk.StackProps {
  vpc: ec2.IVpc,
  cluster: ecs.Cluster,
  sg: ec2.ISecurityGroup,
  MediumArticleTaskRole: iam.Role,
  archi: Archi,
  MediumArticleVersion: string
}

export class DeployModelEcsMediumStackCore extends cdk.Stack {
  public readonly MediumArticleVpc: ec2.IVpc;
  public readonly cluster: ecs.Cluster;
  public readonly sg: ec2.ISecurityGroup;
  public readonly MediumArticleTaskRole: iam.Role;
  constructor(scope: cdk.App, id: string, props: DeployModelEcsMediumStackCoreProps) {
      super(scope, id, props);

      if(props.vpc === undefined) {
          // Get VPC
          console.log("Get existing VPC")
          this.MediumArticleVpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
              vpcId: "vpc-123456789abcd"
          });  
      }
      else {
          console.log("Use given VPC")
          this.MediumArticleVpc = props.vpc;
      }

      // Create an ECS cluster
      this.cluster = new ecs.Cluster(this, 'MediumArticleCluster', {            
          vpc: this.MediumArticleVpc,
          clusterName: "MediumArticleCluster",
          containerInsights: true
      });

      // The SG shall be retrieved from infra stack to support bastion usage
      this.sg = ec2.SecurityGroup.fromSecurityGroupId(this, "MediumArticle-SG", "sg-123456789abc")        

      // SQS Queue
      const queue = new sqs.Queue(this, "MediumArticleQueue", {
          queueName: "MediumArticleQueue"
      })
      
      const lambda_role = new iam.Role(this, "MediumArticleCoreLambdaRole", {
          assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMFullAccess"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSQSFullAccess")
          ],
          roleName: "MediumArticleCoreLambdaRole"
      })

      // Creating Lambda function that will be triggered by the SQS Queue
      const sqs_lambda = new lambda.Function(this,'MediumArticleSqsTriggerLambda', {
              functionName: "MediumArticleSqsTriggerLambda",
              handler: 'lambda_handler.handler',
              runtime: lambda.Runtime.PYTHON_3_8,
              code: lambda.Code.asset('MediumArticle_lambda'),
              role: lambda_role
          }
      )

      // Create an SQS event source for Lambda
      const sqs_event_source = new lambda_event_source.SqsEventSource(queue, {
          batchSize: 1
      })

      // Add SQS event source to the Lambda function
      sqs_lambda.addEventSource(sqs_event_source)

      this.MediumArticleTaskRole = new iam.Role(this, "EcsMediumArticleTaskRole", {
          assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
          managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSQSFullAccess"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
              iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleForSSM")
          ],
          roleName: "EcsMediumArticleTaskRole"
      })
  }
}

export class DeployModelEcsMediumStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: DeployModelEcsMediumStackProps) {
      super(scope, id, props);

      console.log(`Architecture: ${props.archi}`)

      // Get ECR repo
      const ecrRepoName = "MediumArticle";
      const ecrRepo = ecr.Repository.fromRepositoryAttributes   (
          this,
          "EcrRepo",
          {
              repositoryArn: `arn:aws:ecr:ca-central-1:123456789:repository/${ecrRepoName}`,
              repositoryName: ecrRepoName

          }
      );        
      const ecrImage = ecs.ContainerImage.fromEcrRepository(
          ecrRepo,
          `v${props.MediumArticleVersion}-${props.archi}`
      );

      // The policy to add to the created security group
      const managedPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleForSSM")

      // Choose the proper instance type according to the needed architecture
      const instanceType = props.archi===Archi.Cpu ? "m5a.2xlarge" : "g4dn.2xlarge"

      // Get the right AMI
      const hw = props.archi===Archi.Cpu ? ecs.AmiHardwareType.STANDARD : ecs.AmiHardwareType.GPU
      const ami = new ecs.EcsOptimizedAmi({hardwareType: hw})        

      // Define capacity of the cluster
      const asg = props.cluster.addCapacity(`MediumArticle${props.archi}AutoScalingGroupCapacity`, {
          autoScalingGroupName: `MediumArticle${props.archi}AutoScalingGroup`,
          instanceType: new ec2.InstanceType(instanceType),
          desiredCapacity: 0,
          minCapacity: 0,
          maxCapacity: 2,
          canContainersAccessInstanceRole: true,
          cooldown: cdk.Duration.minutes(15),
          machineImage: ami,
          keyName: "icentia-dev",  // for dev purpose
          vpcSubnets: props.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE})
      });
      asg.addSecurityGroup(props.sg)
      asg.role.addManagedPolicy(managedPolicy)

      // // Add capacity provider to the cluster
      // // https://github.com/aws/aws-cdk/issues/5471#issuecomment-653192581
      // // https://github.com/aws/aws-cdk/pull/9192
      // const asgCapacityProvider = new ecs.CfnCapacityProvider(this, `MediumArticle${props.archi}CapacityCapacityProvider`, {
      //     name: `MediumArticle${props.archi}CapacityCapacityProvider`,
      //     autoScalingGroupProvider: {
      //         autoScalingGroupArn: asg.autoScalingGroupName,
      //         managedScaling: {
      //             maximumScalingStepSize: 1,
      //             minimumScalingStepSize: 1,
      //             status: "ENABLED",  // Whether or not to enable managed scaling for the capacity provider
      //             targetCapacity: 100
      //         }
      //     }
      // })

      // SQS Queue
      const queue = new sqs.Queue(this, `${props.archi}Queue`, {
          queueName: `${props.archi}Queue`,
          visibilityTimeout: cdk.Duration.minutes(30)
      })
      
      const queueMetric = queue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(1),
          statistic: "Average"
      })

      // Scale Out
      const scaleOut = queueMetric.createAlarm(this, `MediumArticle${props.archi}ScaleOut`, {
                                  alarmName: `MediumArticle${props.archi}ScaleOut`,
                                  threshold: 1,
                                  evaluationPeriods: 1,
                                  comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                                  statistic: "Average",
                                  treatMissingData: cw.TreatMissingData.NOT_BREACHING})

      const scalingOutAction = new autoscaling.StepScalingAction(this, `MediumArticle${props.archi}ScaleOutAction`, {
                                  autoScalingGroup: asg,
                                  adjustmentType: appautoscaling.AdjustmentType.EXACT_CAPACITY})
      // As the threshold is set to 1, the lower bound must be equal to 0
      scalingOutAction.addAdjustment({adjustment: 1, lowerBound: 0})
      scaleOut.addAlarmAction(new cwactions.AutoScalingAction(scalingOutAction))

      // Scale In
      const scaleIn = queueMetric.createAlarm(this, `MediumArticle${props.archi}ScaleIn`, {
          alarmName: `MediumArticle${props.archi}ScaleIn`,
          threshold: 0,
          evaluationPeriods: 15,
          comparisonOperator: cw.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
          statistic: "Average",
          treatMissingData: cw.TreatMissingData.BREACHING})
      const scalingInAction = new autoscaling.StepScalingAction(this, `MediumArticle${props.archi}ScaleInAction`, {
          autoScalingGroup: asg,
          adjustmentType: appautoscaling.AdjustmentType.EXACT_CAPACITY})
      scalingInAction.addAdjustment({adjustment: 0, upperBound: 0})
      scaleIn.addAlarmAction(new cwactions.AutoScalingAction(scalingInAction))

      // Task
      const taskDefinition = new ecs.Ec2TaskDefinition(this, `MediumArticle${props.archi}TaskDef`, {
          networkMode: ecs.NetworkMode.AWS_VPC,
          taskRole: props.MediumArticleTaskRole
      });

      // Inject secrets into docker container at runtime
      const containerDefinition = taskDefinition.addContainer(`MediumArticle${props.archi}Container`, {
          image: ecrImage,
          memoryLimitMiB: 30000,
          gpuCount: props.archi===Archi.Cpu ? 0 : 1
      });

      // Instantiate an Amazon ECS Service
      const ecsService = new ecs.Ec2Service(this, `MediumArticle${props.archi}Service`, {
          cluster: props.cluster,
          taskDefinition: taskDefinition,
          desiredCount: 0,
          securityGroup: props.sg,
          serviceName: `MediumArticle${props.archi}Service`,
          vpcSubnets: props.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE})
      }); 

      const serviceScaling = ecsService.autoScaleTaskCount({minCapacity: 0, maxCapacity: 2});
      serviceScaling.scaleOnMetric(`MediumArticle${props.archi}ServiceStepScaling`, {
          metric: queueMetric,
          scalingSteps: [
              { upper: 0, change: 0 },
              { lower: 1, change: 1 }
          ],
          cooldown: cdk.Duration.minutes(15),
          adjustmentType: appautoscaling.AdjustmentType.EXACT_CAPACITY
      })
  }
};