import mongoose, { Schema, Document } from "mongoose";

export type NotificationKind =
  | "upload"
  | "processing"
  | "ready"
  | "error"
  | "system";

export interface INotification extends Document {
  videoId: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  status?: string;
  progress?: number;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    videoId: { type: String, required: true, index: true },
    kind: {
      type: String,
      enum: ["upload", "processing", "ready", "error", "system"],
      required: true,
    },
    title: { type: String, required: true, maxlength: 255 },
    detail: { type: String, required: true, maxlength: 1000 },
    status: { type: String },
    progress: { type: Number, min: 0, max: 100 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  },
);

NotificationSchema.index({ videoId: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: -1 });

export const NotificationModel = mongoose.model<INotification>(
  "Notification",
  NotificationSchema,
);
