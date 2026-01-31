const express = require('express');
const {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deleteAccount
} = require('../controllers/accountController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getAccounts)
  .post(createAccount);

router.route('/:id')
  .get(getAccount)
  .put(updateAccount)
  .delete(deleteAccount);

module.exports = router;