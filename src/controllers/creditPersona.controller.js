import CreditPerson from "../models/creditPersona.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";

export const createCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, address } = req.body;

  if (!name || !phone) {
    return next(new CustomError(400, "Name and phone are required"));
  }

  const creditPerson = await CreditPerson.create({ name, phone, address });
  res.status(201).json({
    success: true,
    message: "Credit person created successfully",
    data: creditPerson,
  });
});

export const getAllCreditPersons = asyncErrorHandler(async (req, res, next) => {
  const creditPersons = await CreditPerson.find();
  res.status(200).json({
    success: true,
    message: "Credit persons fetched successfully",
    data: creditPersons,
  });
});

export const getCreditPersonById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const creditPerson = await CreditPerson.findById(id);
  res.status(200).json({
    success: true,
    message: "Credit person fetched successfully",
    data: creditPerson,
  });
});

export const updateCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, address } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid credit person ID format"));
  }
  const creditPerson = await CreditPerson.findByIdAndUpdate(
    id,
    { name, phone, address },
    { new: true }
  );
  if (!creditPerson) {
    return next(new CustomError(404, "Credit person not found"));
  }
  res.status(200).json({
    success: true,
    message: "Credit person updated successfully",
    data: creditPerson,
  });
});
