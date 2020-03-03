# 3p_js_analysis
Measure the impact of 3rd party JavaScript by running Lighthouse.

Note: This is not an officially supported Google product.

# Installation

We are using YARN in this project, so just run a simple "yarn install" in the
directory to get all the dependencies.

# Access to Google-APIs

This tool uses Google-Drive API (to copy and create spreadsheets) and the
Google-Sheets API to store data in a spreadsheet. You need a Google project
where both APIs are active.

The (probably) easiest way to make this happen is by following:

1) https://developers.google.com/sheets/api/quickstart/nodejs
2) https://developers.google.com/drive/api/v3/quickstart/nodejs

and click on "Enable the Drive/Sheets API" for both APIs.

You need a "credentials.json" file in the root of the directory.
