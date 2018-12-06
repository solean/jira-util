#!/usr/bin/env node

const JiraApi = require('jira-client');
const program = require('commander');
const chalk = require('chalk');

const username = process.env.JIRA_USERNAME;
const password = process.env.JIRA_PASSWORD;

const jira = new JiraApi({
  protocol: 'https',
  host: 'jira.softrek.com',
  username: username,
  password: password,
  apiVersion: '2'
});


program
  .arguments('<version>')
  .action(parseVersion)
  .parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp(() => '\nUsage: closeJiras <version>\n\n');
}


function parseVersion(version) {
  if (version) {
    closeIssues(version);
  }
}

async function getIssuesByFixVersion(version) {
  if (!version) return [];
  const results = await jira.searchJira(`fixVersion=${version}`);
  return results && results.issues ? results.issues : [];
}

async function getTransitions(issueId) {
  if (!issueId) return null;
  const transitions = await jira.listTransitions(issueId);
  return transitions;
}

async function closeIssue(issue) {
  if (!issue || !issue.key || !issue.fields || !issue.fields.status) return;
  const key = issue.key;
  const status = issue.fields.status.name;
  if (status === 'Closed') {
    return `${key} - ${chalk.yellow('Issue already Closed')}`;
  } else if (status !== 'Resolved') {
    return `${key} - ${chalk.red('Issue not Resolved yet, can\'t be closed')}`;
  }

  const transitions = await getTransitions(key);
  const closeTransition = transitions && transitions.transitions.find(t => {
    return t.name === 'Close Issue';
  });

  if (closeTransition && closeTransition.id) {
    await jira.transitionIssue(key, {
      transition: closeTransition.id
    });
    // make another call to ensure that the issue is now closed?
    return `${key} - ${chalk.green('Closed')}`;
  } else {
    return `${key} - ${chalk.red('Close Transition not available, reason unknown...')}`;
  }
}

async function closeIssues(version) {
  const issues = await getIssuesByFixVersion(version);
  const responses = await Promise.all(issues.map(closeIssue));
  responses.forEach(res => { console.log(res); });
}

async function getSprintIssues(sprintName) {
  const results = await jira.searchJira(`sprint=${sprintName}`);
  return results && results.issues ? results.issues : [];
}

async function generateReleaseNotes(version) {
  const issues = await getIssuesByFixVersion(version);

  if (!issues || !issues.length) {
    return null;
  }

  let newFeatures = [];
  let improved = [];
  let fixes = [];
  let other = [];

  issues.forEach(i => {
    const data = {
      id: i.key,
      type: i.fields.issuetype.name,
      description: i.fields.customfield_10101
    };

    if (data.type === 'New Feature') {
      newFeatures.push(data);
    } else if (data.type === 'Improvement') {
      improved.push(data);
    } else if (data.type === 'Bug') {
      fixes.push(data);
    } else {
      other.push(data);
    }
  });

  return {
    version,
    newFeatures,
    improved,
    fixes,
    other
  };
}
