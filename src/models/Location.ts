import mongoose, { Schema } from "mongoose";
import { ILocation } from "../type";

const locationSchema = new Schema<ILocation>(
  {
    placeId: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    formattedAddress: {
      type: String,
      required: true,
      trim: true,
    },
    coordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    regions: {
      country: { type: String, required: true, trim: true },
      locality: { type: String, trim: true },
      sublocality: { type: String, trim: true },
      sublocality_level_1: { type: String, trim: true },
      administrative_area_level_1: { type: String, trim: true },
      plus_code: { type: String, trim: true },
      political: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

locationSchema.index({ placeId: 1 });
locationSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });
locationSchema.index({ "regions.country": 1 });
locationSchema.index({ name: "text", formattedAddress: "text" });

const Location = mongoose.model<ILocation>("Location", locationSchema);
export default Location;
