const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const moment = require('moment');

// @desc    Create new transaction
// @route   POST /api/transactions
// @access  Private
exports.createTransaction = async (req, res, next) => {
  try {
    const { accountId, type, amount, category, division, description, date, toAccountId } = req.body;

    // Verify account belongs to user
    const account = await Account.findOne({ _id: accountId, userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Create transaction
    const transaction = await Transaction.create({
      userId: req.user.id,
      accountId,
      type,
      amount,
      category,
      division,
      description,
      date: date || new Date(),
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      transferType: type === 'transfer' ? 'transfer_out' : undefined
    });

    // Update account balance
    if (type === 'income') {
      account.balance += amount;
    } else if (type === 'expense') {
      account.balance -= amount;
    } else if (type === 'transfer' && toAccountId) {
      // Handle transfer
      account.balance -= amount;
      
      const toAccount = await Account.findOne({ _id: toAccountId, userId: req.user.id });
      if (toAccount) {
        toAccount.balance += amount;
        await toAccount.save();
        
        // Create corresponding transfer_in transaction
        await Transaction.create({
          userId: req.user.id,
          accountId: toAccountId,
          type: 'transfer',
          amount,
          category: 'Transfer',
          division,
          description: `Transfer from ${account.name}`,
          date: date || new Date(),
          toAccountId: accountId,
          transferType: 'transfer_in'
        });
      }
    }

    await account.save();

    res.status(201).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all transactions
// @route   GET /api/transactions
// @access  Private
exports.getTransactions = async (req, res, next) => {
  try {
    const { 
      type, 
      category, 
      division, 
      startDate, 
      endDate,
      accountId,
      page = 1,
      limit = 50
    } = req.query;

    // Build query
    const query = { userId: req.user.id };

    if (type) query.type = type;
    if (category) query.category = category;
    if (division) query.division = division;
    if (accountId) query.accountId = accountId;
    
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

    res.status(200).json({
      success: true,
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single transaction
// @route   GET /api/transactions/:id
// @access  Private
exports.getTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user.id
    }).populate('accountId toAccountId');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update transaction
// @route   PUT /api/transactions/:id
// @access  Private
exports.updateTransaction = async (req, res, next) => {
  try {
    let transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if transaction is editable (within 12 hours)
    if (!transaction.isEditable) {
      return res.status(403).json({
        success: false,
        message: 'Transaction can only be edited within 12 hours of creation'
      });
    }

    // Store old values for balance adjustment
    const oldAmount = transaction.amount;
    const oldType = transaction.type;

    // Update transaction
    transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    // Adjust account balance
    const account = await Account.findById(transaction.accountId);
    if (account) {
      // Reverse old transaction
      if (oldType === 'income') {
        account.balance -= oldAmount;
      } else if (oldType === 'expense') {
        account.balance += oldAmount;
      }

      // Apply new transaction
      if (transaction.type === 'income') {
        account.balance += transaction.amount;
      } else if (transaction.type === 'expense') {
        account.balance -= transaction.amount;
      }

      await account.save();
    }

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete transaction
// @route   DELETE /api/transactions/:id
// @access  Private
exports.deleteTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if transaction is editable (within 12 hours)
    if (!transaction.isEditable) {
      return res.status(403).json({
        success: false,
        message: 'Transaction can only be deleted within 12 hours of creation'
      });
    }

    // Adjust account balance
    const account = await Account.findById(transaction.accountId);
    if (account) {
      if (transaction.type === 'income') {
        account.balance -= transaction.amount;
      } else if (transaction.type === 'expense') {
        account.balance += transaction.amount;
      }
      await account.save();
    }

    await transaction.deleteOne();

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get transaction summary by category
// @route   GET /api/transactions/summary/category
// @access  Private
exports.getCategorySummary = async (req, res, next) => {
  try {
    const { startDate, endDate, type } = req.query;

    const matchStage = { userId: req.user.id };
    if (type) matchStage.type = type;
    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = new Date(startDate);
      if (endDate) matchStage.date.$lte = new Date(endDate);
    }

    const summary = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            category: '$category',
            type: '$type'
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          category: '$_id.category',
          type: '$_id.type',
          total: 1,
          count: 1
        }
      },
      { $sort: { total: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};