const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { 
      type: String,
      required: function () {
        // password is required only if the user did NOT sign up via Google
        return !this.googleId;
      }
    },
    googleId: { type: String, required: false, unique: true, sparse: true }, // ✅ support Google login
    isVerified: { type: Boolean, default: false },
    verifyToken: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
