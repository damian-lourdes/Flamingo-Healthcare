/* server/routes/scheduler.js
 * Manual scheduler triggers — for testing or one-off runs from the dashboard.
 */
const router     = require('express').Router();
const scheduler  = require('../services/scheduler');
const engagement = require('../services/engagement');

const jobs = {
  all:       () => scheduler.runDailyJobs(),
  birthdays: () => scheduler.runBirthdays(),
  festivals: () => scheduler.runFestivalGreetings(),
  recalls:   () => engagement.runJobs(),
};

router.post('/run', async (req, res, next) => {
  try {
    const { job = 'all' } = req.body;
    if (!jobs[job]) return res.status(400).json({ success: false, message: `Unknown job: ${job}` });
    jobs[job]().catch(e => console.error(`[scheduler] ${job} error:`, e.message));
    res.json({ success: true, message: `Started: ${job}` });
  } catch (e) { next(e); }
});

module.exports = router;
