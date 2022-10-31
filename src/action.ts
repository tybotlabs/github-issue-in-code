import * as core from '@actions/core';
import { Toolkit } from 'actions-toolkit';
import fm from 'front-matter';
import nunjucks from 'nunjucks';
// @ts-ignore
import dateFilter from 'nunjucks-date-filter';
import { readdirSync } from 'fs';
import { FrontMatterAttributes, listToArray, setOutputs } from './helpers';

function logError(tools: Toolkit, filePath: string, action: 'creating' | 'updating', err: any) {
  // Log the error message
  const errorMessage = `An error occurred while ${action} the issue. Check ${filePath}.`;
  tools.log.error(errorMessage);
  tools.log.error(err);

  // The error might have more details
  if (err.errors) tools.log.error(err.errors);

  // Exit with a failing status
  core.setFailed(errorMessage + '\n\n' + err.message);
  return tools.exit.failure();
}

const getFileList = (dirName: string) => {
  let files: string[] = [];
  const items = readdirSync(dirName, { withFileTypes: true });

  for (const item of items) {
    if (item.isDirectory()) {
      files = [...files, ...getFileList(`${dirName}/${item.name}`)];
    } else {
      files.push(`${dirName}/${item.name}`);
    }
  }

  return files;
};

export async function syncAllIssues(tools: Toolkit) {
  const allFilePaths = getFileList('.');
  const issueFilePaths = allFilePaths.filter((filePath) => filePath.match(/\.issue\.md$/));
  issueFilePaths.forEach((filePath) => syncIssue(tools, filePath));
}

export async function syncIssue(tools: Toolkit, filePath: string) {
  const env = nunjucks.configure({ autoescape: false });
  env.addFilter('date', dateFilter);

  const templateVariables = {
    ...tools.context,
    repo: tools.context.repo,
    env: process.env,
    date: Date.now(),
  };

  // Get the file
  tools.log.debug('Reading from file', filePath);
  const file = (await tools.readFile(filePath)) as string;

  // Grab the front matter as JSON
  const { attributes, body } = fm<FrontMatterAttributes>(file);
  tools.log(`Front matter for ${filePath} is`, attributes);

  const templated = {
    body: env.renderString(body, templateVariables),
    title: env.renderString(attributes.title, templateVariables),
  };
  tools.log.debug('Templates compiled', templated);

  tools.log.info(`Fetching issues with title "${templated.title}"`);
  const existingIssues = await tools.github.search.issuesAndPullRequests({
    q: `is:open is:issue repo:${process.env.GITHUB_REPOSITORY} in:title ${templated.title}`,
  });
  const existingIssue = existingIssues.data.items.find((issue) => issue.title === templated.title);

  if (existingIssue) {
    try {
      tools.log.info(
        `Updating existing issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`
      );
      const issue = await tools.github.issues.update({
        ...tools.context.repo,
        issue_number: existingIssue.number,
        body: templated.body,
      });
      setOutputs(tools, issue);
      tools.exit.success(
        `Updated issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`
      );
    } catch (err: any) {
      return logError(tools, filePath, 'updating', err);
    }
  } else {
    tools.log.info('No existing issue found to update');
  }

  // Create the new issue
  tools.log.info(`Creating new issue ${templated.title}`);
  try {
    const issue = await tools.github.issues.create({
      ...tools.context.repo,
      ...templated,
      // assignees: assignees ? listToArray(assignees) : listToArray(attributes.assignees),
      // labels: listToArray(attributes.labels),
      // milestone: Number(tools.inputs.milestone || attributes.milestone) || undefined
    });

    setOutputs(tools, issue);
    tools.log.success(
      `Created issue ${issue.data.title}#${issue.data.number}: ${issue.data.html_url}`
    );
  } catch (err: any) {
    return logError(tools, filePath, 'creating', err);
  }
}
