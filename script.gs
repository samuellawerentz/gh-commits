var TOKEN = 'token here'
const SHEET_NAME = 'User Contributions';

function fetchUserContributions() {
  Logger.log('Starting fetchUserContributions function');
  const users = ['ashishrai-plivo',
'deepakplivo',
'mimanshi-plivo',
'sathwik-aileneni',
'milindw-97',
'amalshaji-plivo', 'ankit-plivo', 'lalith-plivo', 'mridula-plivo', 'sravanthi-plivo', 'sushant-plivo', 'deep410',
'deepak-v-plivo',
'ShreyaPandoh-plivo',
'samuellawerentz',
'rishabhsharma3'];
  const org = 'contacto-io';
  const manualRepos = ['aiassist', 'workflow-integration-service', 'contacto-core', 'conversation-management-service', 'contacto-console', 'contacto-PHLO-runner-service', 'contacto-PHLO-core', 'contacto-PHLO-config-service', 'queue-execution-service', 'contacto-consul-cfg', 'contacto-clickhouse-db', 'cdp-service', 'plivocx-service']; // Add specific repo names here if needed, e.g., ['repo1', 'repo2']
  const summarySheet = getOrCreateSheet(SHEET_NAME);
  clearSheet(summarySheet);
  ensureSummaryHeaderRow(summarySheet);

  Logger.log(`Fetching contributions for ${users.length} users in the ${org} organization`);

  const options = {
    headers: {
      "Authorization": "Bearer " + TOKEN,
      "Accept": "application/vnd.github.v3+json"
    },
    method: "GET",
    muteHttpExceptions: true
  };

  const until = new Date();
  const since = new Date(until.getFullYear(), until.getMonth(), 1); // Start of the current month
  Logger.log(`Time frame: ${since.toISOString()} to ${until.toISOString()}`);

  // Fetch active repositories for the organization or use manual repos
  let repos;
  if (manualRepos.length > 0) {
    repos = manualRepos.map(repo => `${org}/${repo}`);
    Logger.log(`Using ${repos.length} manually specified repositories`);
  } else {
    repos = getActiveRepos(org, options, since);
    Logger.log(`Found ${repos.length} active repositories in the ${org} organization`);
  }

  Logger.log(`Fetching contributions for ${users.length} users across ${repos.length} repositories`);

  const repoBranches = {};
  repos.forEach(repo => {
    repoBranches[repo] = getActiveBranches(repo, options, since);
  });

  users.forEach(user => {
    const userSheet = getOrCreateSheet(user);
    clearSheet(userSheet);
    ensureHeaderRow(userSheet);
    
    let rowIndex = 2;
    let totalCommits = 0;
    let totalLinesChanged = 0;
    let totalOpenPRs = 0;
    let totalMergedPRs = 0;
    let totalReviewedPRs = 0;

    repos.forEach(repo => {
      try {
        const commits = getUserCommitsForRepo(user, repo, repoBranches[repo], options, since, until);
        rowIndex = addCommitsToSheet(userSheet, commits, repo, rowIndex);
        
        // Calculate repo-specific stats
        const repoStats = calculateRepoStats(commits, user, repo, options, since, until);
        totalCommits += repoStats.commits;
        totalLinesChanged += repoStats.linesChanged;
        totalOpenPRs += repoStats.openPRs;
        totalMergedPRs += repoStats.mergedPRs;
        totalReviewedPRs += repoStats.reviewedPRs;
      } catch (error) {
        Logger.log(`Error fetching contributions for ${user} in ${repo}: ${error.message}`);
      }
    });

    addSummaryFormulas(userSheet, rowIndex);

    // Add total row for the user to summary sheet
    addSummaryRow(summarySheet, user, {
      commits: totalCommits,
      linesChanged: totalLinesChanged,
      openPRs: totalOpenPRs,
      mergedPRs: totalMergedPRs,
      reviewedPRs: totalReviewedPRs
    });
  });
  Logger.log('User contribution data has been fetched and added to individual sheets and summary sheet.');
}

function clearSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).clear();
  }
}

function ensureHeaderRow(sheet) {
  sheet.getRange('A1:F1').setValues([['Date', 'Repository', 'Commit Message', 'Lines Changed', 'Short SHA', 'Branch']]);
  sheet.getRange('A1:F1').setFontWeight('bold');

   // Set the width of the Repository column (column B) to be wider
  sheet.setColumnWidth(2, 200); // 200 pixels wide, adjust as needed 
  
  // Set the width of the Commit Message column (column C) to be wider
  sheet.setColumnWidth(3, 400); // 400 pixels wide, adjust as needed
  
  // Set the width of the Short SHA column (column E) to be wider
  sheet.setColumnWidth(5, 100); // 100 pixels wide, adjust as needed
  
  // Set the width of the Branch column (column F) to be wider
  sheet.setColumnWidth(6, 150); // 150 pixels wide, adjust as needed
}

function getUserCommitsForRepo(username, repo, branches, options, since, until) {
  Logger.log(`Fetching commits for user ${username} in repo ${repo}`);
  const commits = [];
  const processedCommits = new Set();
  const uniqueMessages = new Set();

  branches.forEach(branch => {
    let page = 1;
    const perPage = 100; // GitHub's max per page

    while (true) {
      const commitsUrl = `https://api.github.com/repos/${repo}/commits?author=${username}&sha=${branch}&since=${since.toISOString()}&until=${until.toISOString()}&page=${page}&per_page=${perPage}`;
      const commitsResponse = UrlFetchApp.fetch(commitsUrl, options);
      handleRateLimit(commitsResponse);
      const branchCommits = JSON.parse(commitsResponse.getContentText());

      if (branchCommits.length === 0) {
        break; // No more commits on this branch
      }

      branchCommits.forEach(commit => {
        if (!processedCommits.has(commit.sha)) {
          processedCommits.add(commit.sha);
          const commitUrl = commit.url;
          const commitResponse = UrlFetchApp.fetch(commitUrl, options);
          handleRateLimit(commitResponse);
          const commitDetails = JSON.parse(commitResponse.getContentText());
          
          // Check if it's not a merge commit and the commit message is unique
          if (commitDetails.parents.length <= 1 && !uniqueMessages.has(commitDetails.commit.message)) {
            uniqueMessages.add(commitDetails.commit.message);
            commits.push({
              message: commitDetails.commit.message,
              linesChanged: commitDetails.stats.total,
              date: new Date(commitDetails.commit.author.date),
              repo: repo,
              sha: commit.sha,
              branch: branch
            });
          }
        }
      });

      if (branchCommits.length < perPage) {
        break; // Last page for this branch
      }

      page++;
    }
  });

  return commits;
}

function addCommitsToSheet(sheet, commits, repo, startRow) {
  commits.forEach(commit => {
    sheet.getRange(startRow, 1, 1, 6).setValues([[
      commit.date,
      commit.repo,
      commit.message,
      commit.linesChanged,
      commit.sha.substring(0, 7),
      commit.branch  // Add the branch information
    ]]);
    startRow++;
  });
  return startRow;
}

function addSummaryFormulas(sheet, lastRow) {
  // Add total commit count
  sheet.getRange('G1').setValue('Total Commits');
  sheet.getRange('H1').setFormula(`=COUNTA(A2:A${lastRow - 1})`);

  // Add commit counts per repo
  const repos = getUniqueRepos(sheet, lastRow);
  let row = 3;
  repos.forEach(repo => {
    sheet.getRange(`G${row}`).setValue(repo);
    sheet.getRange(`H${row}`).setFormula(`=COUNTIF(B2:B${lastRow - 1}, G${row})`);
    row++;
  });
}

function getUniqueRepos(sheet, lastRow) {
  const repoRange = sheet.getRange(`B2:B${lastRow - 1}`);
  const repoValues = repoRange.getValues();
  const uniqueRepos = new Set(repoValues.map(row => row[0]).filter(Boolean));
  return Array.from(uniqueRepos);
}

function getOrCreateSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function getActiveBranches(repo, options, since) {
  let allBranches = [];
  let page = 1;
  const perPage = 100;  // Maximum allowed by GitHub API

  while (true) {
    const branchesUrl = `https://api.github.com/repos/${repo}/branches?per_page=${perPage}&page=${page}`;
    const branchesResponse = UrlFetchApp.fetch(branchesUrl, options);
    handleRateLimit(branchesResponse);
    const branches = JSON.parse(branchesResponse.getContentText());

    if (!Array.isArray(branches) || branches.length === 0) {
      break;  // No more branches or unexpected response
    }

    allBranches = allBranches.concat(branches);
    
    if (branches.length < perPage) {
      break;  // Last page
    }

    page++;
  }

  Logger.log(`Fetched ${allBranches.length} branches for ${repo}`);

  const activeBranches = [];
  for (const branch of allBranches) {
    try {
      const commitUrl = `https://api.github.com/repos/${repo}/commits/${branch.name}`;
      const commitResponse = UrlFetchApp.fetch(commitUrl, options);
      handleRateLimit(commitResponse);
      const latestCommit = JSON.parse(commitResponse.getContentText());
      const latestCommitDate = new Date(latestCommit.commit.author.date);
      if (latestCommitDate >= since) {
        activeBranches.push(branch.name);
      }
    } catch (error) {
      Logger.log(`Error checking branch ${branch.name} in repo ${repo}: ${error.message}`);
    }
  }

  Logger.log(`Found ${activeBranches.length} active branches for ${repo}`);
  return activeBranches;
}

function handleRateLimit(response) {
  const remainingRequests = parseInt(response.getHeaders()['x-ratelimit-remaining']);
  const resetTime = parseInt(response.getHeaders()['x-ratelimit-reset']);
console.log(remainingRequests, resetTime)
  if (remainingRequests <= 1) {
    const sleepTime = (resetTime * 1000) - Date.now() + 1000; // Add 1 second buffer
    if (sleepTime > 0) {
      Utilities.sleep(sleepTime);
    }
  }
}

function ensureSummaryHeaderRow(sheet) {
  Logger.log('Ensuring summary header row is present');
  
  // Add month and year header
  const currentDate = new Date();
  const monthYear = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), "MMMM yyyy");
  
  // Merge cells A1:G1 for the month-year header
  sheet.getRange('A1:G1').merge();
  const headerCell = sheet.getRange('A1');
  headerCell.setValue(monthYear);
  headerCell.setFontWeight('bold');
  headerCell.setFontSize(14);
  headerCell.setHorizontalAlignment('center');
  headerCell.setVerticalAlignment('middle');
  
  // Set the height of the merged cell
  sheet.setRowHeight(1, 30);
  
  // Add summary headers in the second row
  sheet.getRange('A2:G2').setValues([['User', 'Commits', 'Lines Changed', 'Open PRs', 'Merged PRs', 'Reviewed PRs', 'Last Updated']]);
  sheet.getRange('A2:G2').setFontWeight('bold');
}

function calculateRepoStats(commits, user, repo, options, since, until) {
  Logger.log(`Calculating stats for user ${user} in repo ${repo}`);
  const stats = {
    commits: commits.length,
    linesChanged: commits.reduce((total, commit) => total + commit.linesChanged, 0),
    openPRs: 0,
    mergedPRs: 0,
    reviewedPRs: 0
  };

  // Fetch PRs
  const prsUrl = `https://api.github.com/repos/${repo}/pulls?state=all`;
  const prsResponse = UrlFetchApp.fetch(prsUrl, options);
  handleRateLimit(prsResponse);
  const prs = JSON.parse(prsResponse.getContentText());

  prs.forEach(pr => {
    const prCreatedAt = new Date(pr.created_at);
    const prUpdatedAt = new Date(pr.updated_at);
    
    if (pr.user.login === user && prCreatedAt >= since && prCreatedAt <= until) {
      if (pr.state === 'open') {
        stats.openPRs++;
      } else if (pr.state === 'closed' && pr.merged_at) {
        stats.mergedPRs++;
      }
    }
    
    // Check if the user reviewed this PR
    if (prUpdatedAt >= since && prUpdatedAt <= until) {
      const reviewsUrl = pr.review_comments_url;
      const reviewsResponse = UrlFetchApp.fetch(reviewsUrl, options);
      handleRateLimit(reviewsResponse);
      const reviews = JSON.parse(reviewsResponse.getContentText());
      
      if (reviews.some(review => review.user.login === user)) {
        stats.reviewedPRs++;
      }
    }
  });

  Logger.log(`Stats for ${user} in ${repo}: ${JSON.stringify(stats)}`);
  return stats;
}

function addSummaryRow(sheet, user, stats) {
  Logger.log(`Adding summary row for user ${user}`);
  const lastRow = sheet.getLastRow();
  const formattedDate = formatDate(new Date());
  sheet.getRange(lastRow + 1, 1, 1, 7).setValues([[
    user,
    stats.commits.toString(),
    stats.linesChanged.toString(),
    stats.openPRs.toString(),
    stats.mergedPRs.toString(),
    stats.reviewedPRs.toString(),
    formattedDate
  ]]);
}

function formatDate(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const day = date.getDate();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  
  return `${dayName}, ${monthName} ${day}, ${hours}:${minutes}${ampm}`;
}

function getActiveRepos(org, options, since) {
  Logger.log(`Fetching active repositories for organization: ${org}`);
  let allRepos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const reposUrl = `https://api.github.com/orgs/${org}/repos?per_page=${perPage}&page=${page}`;
    const reposResponse = UrlFetchApp.fetch(reposUrl, options);
    handleRateLimit(reposResponse);
    const repos = JSON.parse(reposResponse.getContentText());

    if (!Array.isArray(repos) || repos.length === 0) {
      break;
    }

    allRepos = allRepos.concat(repos);

    if (repos.length < perPage) {
      break;
    }

    page++;
  }

  Logger.log(`Fetched ${allRepos.length} repositories for ${org}`);

  const activeRepos = [];
  for (const repo of allRepos) {
    try {
      const commitUrl = `https://api.github.com/repos/${org}/${repo.name}/commits?per_page=1`;
      const commitResponse = UrlFetchApp.fetch(commitUrl, options);
      handleRateLimit(commitResponse);
      const latestCommit = JSON.parse(commitResponse.getContentText())[0];
      const latestCommitDate = new Date(latestCommit.commit.author.date);
      if (latestCommitDate >= since) {
        activeRepos.push(`${org}/${repo.name}`);
      }
    } catch (error) {
      Logger.log(`Error checking repository ${repo.name}: ${error.message}`);
    }
  }

  Logger.log(`Found ${activeRepos.length} active repositories for ${org}`);
  return activeRepos;
}

