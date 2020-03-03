/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');

const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',  // Scope needed to write into spreadsheet
    'https://www.googleapis.com/auth/drive'          // Scope needed to copy template file as new spreadsheet
];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// File ID of the sheet used as template for the output
const TEMPLATE_ID = '1fntMyGqNo6Ti-Jj6DPKcyAUcA2U4jSS6g_4DjH_Ozkw';

/*****************************************************************************
* The "main" function.
*
* Read URL from argsv, analyze 3rd-party-scripts on given URL and write
* results into spreadsheet.
*****************************************************************************/

// Read URL from argv
let url = process.argv[2];
if (url.indexOf('http') != 0) {
  console.log("Usage: node 3rd-party-impact.js <url>");
  return;
}

console.log("");
console.log("Program has started. Analysing 3rd party script on: " + url);

// Flags for Chrome used by Lighthouse run
let opts = {
  chromeFlags: ['--headless']
};

// Lighthouse config. Limiting the audits to "third-party-summit".
let config = {
  extends: 'lighthouse:default',
  settings: {
    onlyAudits: [
      'third-party-summary',
    ],
  },
}

launchChromeAndRunLighthouse(url, opts, config).then( (lhResults) => {
  let items = lhResults.audits["third-party-summary"].details.items;
  let result = [];

  console.log(items);

  // Items from LHReport are JSON objects. Spreadsheet needs data as array.
  for(item in items) {
    let tagName = items[item].entity.text;
    let type = mapTagNameToType(tagName);
    let blockingTime = parseInt(items[item].blockingTime);  // Time is in ms.
    let mainThreadTime = parseInt(items[item].mainThreadTime);  // Time is in ms.
    let transferSize = parseInt(items[item].transferSize) / 1024;  // Convert from Byte to KB.
    result.push([ url, tagName, type, blockingTime, mainThreadTime, transferSize ]);
  }

  // Load client secrets from a local file.
  fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Google APIs (Drive +
    // Sheet) to add data into a spreadsheet.
    authorize(JSON.parse(content), addResultsToSpeadsheet, result);
  });

});

/*****************************************************************************
* Functions used to get Lighthouse report.
*****************************************************************************/

/**
 * Launch Chrome and run Lighthouse on a given URL.
 * @param {string} url URL of website to test.
 * @param {Object} opts Extra parameter used for starting Chrome.
 * @param {Object} config Configuration for Lighthouse.
 */
function launchChromeAndRunLighthouse(url, opts, config = null) {
  console.log("Opening Chrome to make Lighthouse run...");
  return chromeLauncher.launch({chromeFlags: opts.chromeFlags}).then(chrome => {
    opts.port = chrome.port;
    return lighthouse(url, opts, config).then(results => {
      return chrome.kill().then(() => results.lhr)
    });
  });
}

/**
 * Little helper to map a given tagname to a type
 * @param (string) Name of the string as given by Lighthouse
 * @return (string) The "mapped" type for the given tagname.
 */
function mapTagNameToType(tagName) {
  if(tagName.toLowerCase().indexOf(' ads') > 0) {
    return "Ads";
  } else if (tagName.toLowerCase().indexOf('analytics') > 0) {
    return "Analytics";
  } else {
    return "other";
  }

}

/*****************************************************************************
* Functions related to writing data into spreadsheets (via Google-Sheets-API).
*****************************************************************************/

/**
 * Adds results from Lighthouse report into a spreadsheet.
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 * @param {array} Array of strings containing the results from Lighthouse run.
 */
function addResultsToSpeadsheet(auth, items) {
  const sheets = google.sheets({version: 'v4', auth});
  const drive = google.drive({version: 'v3', auth});

  // Make a copy of the report template.
  console.log("Making a copy of the report TEMPLATE file....");
  drive.files.copy({
    fileId: TEMPLATE_ID,
  }, (err, res) => {
     if (err) return console.log('The API returned an error: ' + err);
     let spreadsheetID = res.data.id;
     let range = 'Actions!A2:F';
     let valueInputOption = "RAW";
     // Write results from test into the new spreadsheet.
     console.log("Now writing results into new spreadsheet: https://docs.google.com/spreadsheets/d/" + spreadsheetID);
     writeSheet(sheets, spreadsheetID, range, valueInputOption, items).then( (result) => {
       console.log('%d cells updated.', result.updatedCells);
     });
   }
  );
}

/**
 * Little helper to write data into a spreadsheet.
 * @param {Object} sheets Google sheets object, expected to be "authenticated".
 * @param {string} spreadsheetId Id of the spreadsheet that is used to put data
 * into.
 * @param {string} range Range notation for spreadsheet. The area where data is
 * written to.
 * @param {string} valueInputOption ValueInputOption for spreadsheet.
 * @param {array} values Data values that will be written into the spreadsheet.
 */
function writeSheet(sheets, spreadsheetId, range, valueInputOption, values, ) {
  resource = {
    values
  };
  return sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption, resource, })
    .then(response => response.data);
}

/*****************************************************************************
* Functions related to OAuth (authentication against Google-APIs).
*****************************************************************************/

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback, items) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client, items);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error while trying to retrieve access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}
