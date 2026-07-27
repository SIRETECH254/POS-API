import { Document, Types } from "mongoose";

export type UserRole =
  | "bartender"
  | "cashier"
  | "store_keeper"
  | "manager"
  | "admin"
  | "accountant";

export interface IRole extends Document {
  name: UserRole;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  roles: UserRole[];
  branch: Types.ObjectId;
  isActive: boolean;
  avatar?: string;
  avatarPublicId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILocationRegions {
  country: string;
  locality?: string;
  sublocality?: string;
  sublocality_level_1?: string;
  administrative_area_level_1?: string;
  plus_code?: string;
  political?: string;
}

export interface ILocation extends Document {
  placeId?: string;
  name: string;
  formattedAddress: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  regions: ILocationRegions;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAddress extends Document {
  userId: Types.ObjectId;
  name: string;
  location: Types.ObjectId | ILocation;
  details?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBranch extends Document {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: Types.ObjectId | IAddress;
  isMain: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
