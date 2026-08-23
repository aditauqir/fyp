#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ledgerPath = path.join(root, 'BUG-FIXES.md');
const jsonPath = process.argv[2];

function readIssues() {
  if (jsonPath) {
    return JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
  }

  const output = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      'aditauqir/fyp',
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'number,title,state,url',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  return JSON.parse(output);
}

function readLedger() {
  const markdown = fs.readFileSync(ledgerPath, 'utf8');
  const tracked = new Map();

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| [#')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const number = Number(cells[0]?.match(/^\[#(\d+)\]\(/)?.[1]);
    if (!number) continue;
    tracked.set(number, {
      title: cells[1],
      githubState: cells[2]?.replaceAll('*', ''),
      branchState: cells[3],
    });
  }

  return tracked;
}

let issues;
try {
  issues = readIssues();
} catch (error) {
  console.error(
    'Could not read live GitHub issues. Use the cached BUG-FIXES.md ledger and label the report as cached.'
  );
  process.exit(error.status || 1);
}

const tracked = readLedger();
const failures = [];

console.log('| Issue | Live state | Tracked state | Branch state | Title |');
console.log('|---|---|---|---|---|');

for (const issue of issues.sort((a, b) => a.number - b.number)) {
  const entry = tracked.get(issue.number);
  const trackedState = entry?.githubState || 'MISSING';
  const branchState = entry?.branchState || 'Not tracked';
  console.log(
    `| [#${issue.number}](${issue.url}) | ${issue.state} | ${trackedState} | ${branchState} | ${issue.title} |`
  );

  if (!entry) {
    failures.push(`Issue #${issue.number} is missing from BUG-FIXES.md.`);
    continue;
  }
  if (entry.githubState !== issue.state) {
    failures.push(
      `Issue #${issue.number} is ${issue.state} on GitHub but ${entry.githubState} in BUG-FIXES.md.`
    );
  }
  if (entry.title !== issue.title) {
    failures.push(`Issue #${issue.number} has a stale title in BUG-FIXES.md.`);
  }
}

const liveNumbers = new Set(issues.map((issue) => issue.number));
for (const number of tracked.keys()) {
  if (!liveNumbers.has(number)) {
    failures.push(`BUG-FIXES.md tracks issue #${number}, but GitHub did not return it.`);
  }
}

if (failures.length) {
  console.error('\nIssue ledger check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nIssue ledger matches every GitHub issue.');
}
