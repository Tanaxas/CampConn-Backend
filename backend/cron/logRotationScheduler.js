// Add to cron setup (if using a scheduler like node-cron)
const cron = require('node-cron');
const { rotateAndArchiveLogs } = require('../scripts/logRotation');

// Run log rotation every day at midnight
cron.schedule('0 0 * * *', () => {
  console.log('Running scheduled log rotation...');
  rotateAndArchiveLogs();
});