const express = require('express');
const {
    getDashboardSummary,
    getTrend,
    getCategoryBreakdown,
    getDivisionBreakdown
} = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/dashboard', getDashboardSummary);
router.get('/trend', getTrend);
router.get('/category-breakdown', getCategoryBreakdown);
router.get('/division-breakdown', getDivisionBreakdown);

module.exports = router;