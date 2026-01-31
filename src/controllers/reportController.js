const Transaction = require('../models/Transaction');
const moment = require('moment');

// @desc    Get dashboard summary
// @route   GET /api/reports/dashboard
// @access  Private
exports.getDashboardSummary = async (req, res, next) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;

        let dateFilter = {};
        const now = new Date();

        if (startDate && endDate) {
            dateFilter = {
                date: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };
        } else {
            switch (period) {
                case 'week':
                    dateFilter = {
                        date: {
                            $gte: moment().startOf('week').toDate(),
                            $lte: moment().endOf('week').toDate()
                        }
                    };
                    break;
                case 'month':
                    dateFilter = {
                        date: {
                            $gte: moment().startOf('month').toDate(),
                            $lte: moment().endOf('month').toDate()
                        }
                    };
                    break;
                case 'year':
                    dateFilter = {
                        date: {
                            $gte: moment().startOf('year').toDate(),
                            $lte: moment().endOf('year').toDate()
                        }
                    };
                    break;
            }
        }

        const summary = await Transaction.aggregate([
            {
                $match: {
                    userId: req.user._id,
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: '$type',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const income = summary.find(s => s._id === 'income')?.total || 0;
        const expense = summary.find(s => s._id === 'expense')?.total || 0;
        const balance = income - expense;

        res.status(200).json({
            success: true,
            data: {
                period,
                income,
                expense,
                balance,
                transactions: {
                    income: summary.find(s => s._id === 'income')?.count || 0,
                    expense: summary.find(s => s._id === 'expense')?.count || 0
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get income/expense trend
// @route   GET /api/reports/trend
// @access  Private
exports.getTrend = async (req, res, next) => {
    try {
        const { period = 'month', groupBy = 'day' } = req.query;

        let dateFilter = {};
        let groupFormat;

        switch (groupBy) {
            case 'day':
                groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
                break;
            case 'week':
                groupFormat = { $dateToString: { format: '%Y-W%V', date: '$date' } };
                break;
            case 'month':
                groupFormat = { $dateToString: { format: '%Y-%m', date: '$date' } };
                break;
            case 'year':
                groupFormat = { $dateToString: { format: '%Y', date: '$date' } };
                break;
            default:
                groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
        }

        const now = new Date();
        switch (period) {
            case 'week':
                dateFilter = {
                    date: { $gte: moment().subtract(7, 'days').toDate() }
                };
                break;
            case 'month':
                dateFilter = {
                    date: { $gte: moment().subtract(30, 'days').toDate() }
                };
                break;
            case 'year':
                dateFilter = {
                    date: { $gte: moment().subtract(365, 'days').toDate() }
                };
                break;
        }

        const trend = await Transaction.aggregate([
            {
                $match: {
                    userId: req.user._id,
                    ...dateFilter
                }
            },
            {
                $group: {
                    _id: {
                        period: groupFormat,
                        type: '$type'
                    },
                    total: { $sum: '$amount' }
                }
            },
            {
                $group: {
                    _id: '$_id.period',
                    income: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0]
                        }
                    },
                    expense: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0]
                        }
                    }
                }
            },
            { $sort: { _id: 1 } },
            {
                $project: {
                    _id: 0,
                    period: '$_id',
                    income: 1,
                    expense: 1,
                    balance: { $subtract: ['$income', '$expense'] }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: trend
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get spending by category
// @route   GET /api/reports/category-breakdown
// @access  Private
exports.getCategoryBreakdown = async (req, res, next) => {
    try {
        const { type = 'expense', division, startDate, endDate } = req.query;

        const matchStage = {
            userId: req.user._id,
            type
        };

        if (division) matchStage.division = division;

        if (startDate || endDate) {
            matchStage.date = {};
            if (startDate) matchStage.date.$gte = new Date(startDate);
            if (endDate) matchStage.date.$lte = new Date(endDate);
        }

        const breakdown = await Transaction.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$category',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    category: '$_id',
                    total: 1,
                    count: 1
                }
            },
            { $sort: { total: -1 } }
        ]);

        const totalAmount = breakdown.reduce((sum, item) => sum + item.total, 0);

        // Add percentage
        const breakdownWithPercentage = breakdown.map(item => ({
            ...item,
            percentage: ((item.total / totalAmount) * 100).toFixed(2)
        }));

        res.status(200).json({
            success: true,
            data: {
                breakdown: breakdownWithPercentage,
                total: totalAmount
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get division breakdown
// @route   GET /api/reports/division-breakdown
// @access  Private
exports.getDivisionBreakdown = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        const matchStage = { userId: req.user._id };

        if (startDate || endDate) {
            matchStage.date = {};
            if (startDate) matchStage.date.$gte = new Date(startDate);
            if (endDate) matchStage.date.$lte = new Date(endDate);
        }

        const breakdown = await Transaction.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        division: '$division',
                        type: '$type'
                    },
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.division',
                    income: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0]
                        }
                    },
                    expense: {
                        $sum: {
                            $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0]
                        }
                    },
                    transactionCount: { $sum: '$count' }
                }
            },
            {
                $project: {
                    _id: 0,
                    division: '$_id',
                    income: 1,
                    expense: 1,
                    balance: { $subtract: ['$income', '$expense'] },
                    transactionCount: 1
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: breakdown
        });
    } catch (error) {
        next(error);
    }
};