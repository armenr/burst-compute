const AWS = require('aws-sdk');
const moment = require('moment');

const { JOB_TIMEOUT_SECS, TASKS_TABLE_NAME } = process.env;

const docClient = new AWS.DynamoDB.DocumentClient();

const monitorJob = async (jobParams) => {
  // Parameters
  const { jobId, numBatches, searchTimeoutSecs = JOB_TIMEOUT_SECS } = jobParams;
  const startTime = moment(jobParams.startTime);

  // Find out how many tasks are remaining
  const params = {
    TableName: TASKS_TABLE_NAME,
    ConsistentRead: true,
    Select: 'COUNT',
    KeyConditionExpression: 'jobId = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
    ScanIndexForward: true,
  };

  console.log('Fetching result count: ', params);

  let numComplete = 0;
  let countResult;
  do {
    // eslint-disable-next-line no-await-in-loop
    countResult = await docClient.query(params).promise();
    console.log('Scanned count:', JSON.stringify(countResult));
    numComplete += countResult.Count;
    params.ExclusiveStartKey = countResult.LastEvaluatedKey;
  } while (countResult.LastEvaluatedKey);

  console.log(`Tasks completed: ${numComplete}/${numBatches}`);

  // Calculate total time
  const now = new Date();
  const endTime = moment(now.toISOString());
  const elapsedSecs = endTime.diff(startTime, 's');
  const numRemaining = numBatches - numComplete;

  // Return result for next state input
  if (numRemaining === 0) {
    console.log(`Job took ${elapsedSecs} seconds`);
    return {
      ...jobParams,
      elapsedSecs,
      numRemaining: 0,
      completed: true,
      timedOut: false,
    };
  }
  if (elapsedSecs > searchTimeoutSecs) {
    console.log(`Job timed out after ${elapsedSecs} seconds. Completed ${numComplete} of ${numBatches} tasks.`);
    return {
      ...jobParams,
      elapsedSecs,
      numRemaining,
      completed: false,
      timedOut: true,
    };
  }
  console.log(`Job still running after ${elapsedSecs} seconds (${searchTimeoutSecs - elapsedSecs}s remaining). Completed ${numComplete} of ${numBatches} tasks.`);
  return {
    ...jobParams,
    elapsedSecs,
    numRemaining,
    completed: false,
    timedOut: false,
  };
};

exports.monitorHandler = async (event) => {
  console.log('Input event:', JSON.stringify(event));
  try {
    return await monitorJob(event);
  } catch (e) {
    console.log('Error while checking if job completed', event, e);
    return {
      ...event,
      completed: true,
      timedOut: false,
      withErrors: true,
    };
  }
};
