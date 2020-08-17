import boto3


def handler(event, context):
    # Retrieve SQS queue message
    msg = event.get('Records')[0].get('body')

    # Define clients
    session = boto3.Session()
    ssm = session.client('ssm')
    sqs = session.resource('sqs')

    # Get configs
    device = ssm.get_parameter(Name='/device')

    # Choose between CPU and GPU instances
    if device.lower() == "gpu":
        queue_name="GPUQueue"
    else:
        queue_name="CPUQueue"

    queue = sqs.get_queue_by_name(QueueName=queue_name)

    # Send message
    if queue is not None:
        queue.send_message(MessageBody=msg)


if __name__ == "__main__":
    handler({"Records": [{"body": 1}]}, None)