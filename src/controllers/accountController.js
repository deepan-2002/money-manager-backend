const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');

// @desc    Create account
// @route   POST /api/accounts
// @access  Private
exports.createAccount = async (req, res, next) => {
  try {
    const { balance = 0, name, type, currency } = req.body;

    const account = await Account.create({
      name,
      type,
      currency,
      balance: balance,
      openingBalance: balance,
      userId: req.user.id
    });

    // Create a transaction for the opening balance if it's not 0
    if (balance !== 0) {
      await Transaction.create({
        userId: req.user.id,
        accountId: account._id,
        type: balance > 0 ? 'income' : 'expense',
        amount: Math.abs(balance),
        category: 'Opening Balance',
        division: 'personal',
        description: 'Initial Balance',
        date: account.createdAt || new Date()
      });
    }

    res.status(201).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all accounts
// @route   GET /api/accounts
// @access  Private
exports.getAccounts = async (req, res, next) => {
  try {
    const accounts = await Account.find({ userId: req.user.id });

    res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single account
// @route   GET /api/accounts/:id
// @access  Private
exports.getAccount = async (req, res, next) => {
  try {
    const account = await Account.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    res.status(200).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update account
// @route   PUT /api/accounts/:id
// @access  Private
exports.updateAccount = async (req, res, next) => {
  try {
    let account = await Account.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Don't allow updating balance directly
    const updateData = { ...req.body };
    delete updateData.balance;
    delete updateData.openingBalance;

    account = await Account.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete account
// @route   DELETE /api/accounts/:id
// @access  Private
exports.deleteAccount = async (req, res, next) => {
  try {
    const account = await Account.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    await account.deleteOne();

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

exports.getAccountTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, startDate, endDate, type } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user._id || req.user.id);
    const accountObjectId = new mongoose.Types.ObjectId(req.params.id);


    // Verify account belongs to user
    const account = await Account.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Build query - Only look for transactions linked to this account as the primary account
    const query = {
      userId: userId,
      $or: [
        { accountId: accountObjectId },
        { toAccountId: accountObjectId }
      ]
    };

    if (type) query.type = type;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Execute query with pagination
    const transactions = await Transaction.find(query)
      .populate('accountId', 'name type')
      .populate('toAccountId', 'name type')
      .sort({ date: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    // Calculate account summary - using a single set of documents
    const summary = await Transaction.aggregate([
      {
        $match: {
          userId: userId,
          $or: [
            { accountId: accountObjectId },
            { toAccountId: accountObjectId }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$type', 'income'] },
                    {
                      $and: [
                        { $eq: ['$type', 'transfer'] },
                        { $eq: ['$toAccountId', accountObjectId] }
                      ]
                    }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
          totalExpense: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$type', 'expense'] },
                    {
                      $and: [
                        { $eq: ['$type', 'transfer'] },
                        { $eq: ['$accountId', accountObjectId] }
                      ]
                    }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
          transactionCount: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      account: {
        id: account._id,
        name: account.name,
        type: account.type,
        balance: account.balance,
        openingBalance: account.openingBalance,
        currency: account.currency
      },
      summary: summary.length > 0 ? {
        ...summary[0],
        openingBalance: account.openingBalance
      } : {
        totalIncome: 0,
        totalExpense: 0,
        transactionCount: 0,
        openingBalance: account.openingBalance
      },
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Recalculate account balance based on transactions
// @route   POST /api/accounts/:id/recalibrate
// @access  Private
exports.recalibrateAccount = async (req, res, next) => {
  try {
    const account = await Account.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const accountObjectId = new mongoose.Types.ObjectId(req.params.id);

    // Calculate totals
    const result = await Transaction.aggregate([
      {
        $match: {
          userId: userId,
          $or: [
            { accountId: accountObjectId },
            { toAccountId: accountObjectId }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$type', 'income'] },
                    { $and: [{ $eq: ['$type', 'transfer'] }, { $eq: ['$toAccountId', accountObjectId] }] }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
          totalExpense: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$type', 'expense'] },
                    { $and: [{ $eq: ['$type', 'transfer'] }, { $eq: ['$accountId', accountObjectId] }] }
                  ]
                },
                '$amount',
                0
              ]
            }
          }
        }
      }
    ]);

    const totals = result.length > 0 ? result[0] : { totalIncome: 0, totalExpense: 0 };
    const newBalance = (account.openingBalance || 0) + totals.totalIncome - totals.totalExpense;

    account.balance = newBalance;
    await account.save();

    res.status(200).json({
      success: true,
      message: 'Account balance recalibrated',
      data: account
    });
  } catch (error) {
    next(error);
  }
};