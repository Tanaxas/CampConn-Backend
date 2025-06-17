
const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

async function rotateAndArchiveLogs() {
  try {
    console.log('Starting log rotation process...');
    
    // Get retention settings from config
    const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '90');
    const ARCHIVE_LOGS = process.env.ARCHIVE_LOGS === 'true';
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    
    console.log(`Retention policy: ${RETENTION_DAYS} days (before ${format(cutoffDate, 'yyyy-MM-dd')})`);
    
    if (ARCHIVE_LOGS) {
      // Archive logs before deleting
      const [oldLogs] = await pool.execute(
        'SELECT * FROM activity_logs WHERE timestamp < ?',
        [cutoffDate]
      );
      
      if (oldLogs.length > 0) {
        console.log(`Archiving ${oldLogs.length} logs...`);
        
        // Create archive directory if it doesn't exist
        const archiveDir = path.join(__dirname, '../logs/archive');
        if (!fs.existsSync(archiveDir)) {
          fs.mkdirSync(archiveDir, { recursive: true });
        }
        
        // Create archive file
        const archiveDate = format(new Date(), 'yyyy-MM-dd');
        const archiveFile = path.join(archiveDir, `logs_archive_${archiveDate}.json`);
        
        // Write logs to archive
        fs.writeFileSync(archiveFile, JSON.stringify(oldLogs, null, 2));
        console.log(`Logs archived to ${archiveFile}`);
      } else {
        console.log('No logs to archive');
      }
    }
    
    // Delete old logs
    const [result] = await pool.execute(
      'DELETE FROM activity_logs WHERE timestamp < ?',
      [cutoffDate]
    );
    
    console.log(`Deleted ${result.affectedRows} old log entries`);
    console.log('Log rotation completed successfully');
  } catch (error) {
    console.error('Error during log rotation:', error);
  }
}

// Execute directly if called from command line
if (require.main === module) {
  rotateAndArchiveLogs()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { rotateAndArchiveLogs };