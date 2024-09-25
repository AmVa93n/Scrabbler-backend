const express = require("express");
const router = express.Router();
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '../config/sowpods.txt');
const data = fs.readFileSync(filePath, 'utf-8'); // Read the text file content
const dictionary = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);

router.get("/", (req, res, next) => {
  res.json("All good in here");
});

router.get("/ping", async (req, res, next) => {
  res.status(200).send() // this is just to keep the server from spinning down
});

router.get("/dictionary", async (req, res, next) => {
  res.status(200).json({ dictionary: dictionary });
});

module.exports = router;
