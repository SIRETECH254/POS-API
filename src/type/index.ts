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
