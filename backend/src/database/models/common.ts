import { Schema, type SchemaOptions, type SchemaTypeOptions, Types } from 'mongoose';
import { isSupportedCurrency } from '../../services/finance/money.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const baseOptions: SchemaOptions<any, any, any, any, any, any, any> = {
  timestamps: true,
  versionKey: 'version',
  strict: 'throw', // unknown fields are errors, not silently stored
  toJSON: {
    virtuals: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
};

/** Every personal financial document carries an immutable, indexed owner. */
export const userRef = (): SchemaTypeOptions<any> => ({
  type: Schema.Types.ObjectId,
  ref: 'User',
  required: true,
  immutable: true,
});

export const ref = (model: string, required = false): SchemaTypeOptions<any> => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
});

export const currencyField = (): SchemaTypeOptions<any> => ({
  type: String,
  required: true,
  uppercase: true,
  validate: { validator: isSupportedCurrency, message: 'Unsupported currency' },
});

/** BigInt minor units (stored as int64). Never a float. */
export const minorField = (opts: { required?: boolean; min?: bigint } = {}): SchemaTypeOptions<any> => ({
  type: BigInt,
  required: opts.required ?? true,
  validate: {
    validator: (v: bigint) => typeof v === 'bigint' && (opts.min === undefined || v >= opts.min),
    message: 'Must be an integer amount in minor units',
  },
});

/** Soft-delete marker; queries must use `notDeleted` helpers in repositories. */
export const softDelete = { deletedAt: { type: Date, default: null } };

export const oid = (s: string) => new Types.ObjectId(s);
