#!/usr/bin/env node

const JiraApi = require('jira-client');
const program = require('commander');
const chalk = require('chalk');
const moment = require('moment');

const username = process.env.JIRA_USERNAME;
const password = process.env.JIRA_PASSWORD;

const jira = new JiraApi({
  protocol: 'https',
  host: 'jira.softrek.com',
  username: username,
  password: password,
  apiVersion: '2'
});


program.command('issue <issue number>').action(printIssue);
program.command('comments <issue number>').action(printComments);
program.command('close <version>').action(closeIssues);
program.command('notes <version>').action(generateReleaseNotes);
program.command('search <query>').action(search);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  const helpStr = '\nUsage:\n\tjira close <version>\n\tjira notes <version>\n\tjira search \'<query>\'\n\n';
  program.outputHelp(() => helpStr);
}


function handleError(e) {
  let msg = '\nSorry, something went wrong while retrieving Jira issues:\n\n';
  if (e && e.error && e.error.errorMessages && e.error.errorMessages.length) {
    msg += `\t${e.error.errorMessages[0]}\n`;
  }
  console.log(chalk.red(msg));
}

async function search(query) {
  if (!query) return [];
  try {
    const results = await jira.searchJira(query);
    const issues = results && results.issues ? results.issues : [];
    issues.forEach(i => {
      console.log(i.key + ' - ' + i.fields.summary);
    });
    return issues;
  } catch(e) {
    handleError(e);
  }
}

async function printIssue(issueNumber) {
  let issue;
  try {
    issue = await jira.findIssue(issueNumber);
  } catch(e) {
    handleError(e);
    return;
  }
  console.log('\n' + chalk.underline.green(issue.key + ' - ' + issue.fields.summary + '\n'));
  const type = issue.fields.issuetype ? issue.fields.issuetype.name : '';
  console.log(chalk.bold('Type: ') + type);
  const assignee = issue.fields.assignee ? (issue.fields.assignee.displayName + ' - ' + issue.fields.assignee.emailAddress) : '';
  console.log(chalk.bold('Assignee: ') + assignee);
  const status = issue.fields.status ? issue.fields.status.name : '';
  console.log(chalk.bold('Status: ') + status);
  console.log(chalk.bold('Created: ') + moment(issue.fields.created).format('MMMM Do YYYY, h:mm A'));
  let fixVersionsStr = '';
  const fixVersions = issue.fields.fixVersions;
  if (fixVersions && fixVersions.length) {
    const fixVersionNames = fixVersions.map(f => f.name);
    fixVersionsStr = fixVersionNames.join(', ');
  }
  console.log(chalk.bold('Fix Version: ') + fixVersionsStr);
  console.log(chalk.bold('Project Number: ') + (issue.fields.customfield_10022 || ''));
  console.log(chalk.bold('Labels: ') + issue.fields.labels);
  console.log(chalk.bold('\nDescription:\n') + chalk.yellow(issue.fields.description));
  // issue.fields.issueLinks
  const numComments = issue.fields.comment && issue.fields.comment.comments && issue.fields.comment.comments.length;
  console.log('\n' + (numComments || 0) + (numComments === 1 ? ' Comment' : ' Comments') + '\n');
}

async function getComments(issueNumber) {
  let issue;
  try {
    issue = await jira.findIssue(issueNumber);
  } catch(e) {
    handleError(e);
    return;
  }
  console.log(chalk.underline.green(issue.key + ' - ' + issue.fields.summary + '\n\n'));

  const comments = issue.fields.comment.comments;
  return comments;
}

async function printComments(issueNumber) {
  let comments = await getComments(issueNumber);
  comments && comments.forEach(c => {
    const formattedDate = moment(c.created).format('MMMM Do YYYY, h:mm A');
    const formattedAuthor = c.author.displayName + ' (' + c.author.emailAddress + ')';
    console.log(chalk.underline.yellow(formattedAuthor + ' - ' + formattedDate));
    console.log(c.body);
    console.log('\n');
  });
}

async function getIssuesByFixVersion(version) {
  if (!version) return [];
  return search(`fixVersion=${version}`);
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
  let issues;
  try {
    issues = await getIssuesByFixVersion(version);
  } catch(e) {
    console.log(chalk.red(e));
    return null;
  }

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
