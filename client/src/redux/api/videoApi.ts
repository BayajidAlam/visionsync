import { baseApi } from "./baseApi";
import { tagTypes } from "../tag-types";

const VIDEO_URL = "/videos";

export const videosApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // upload video
    addVideoWithFormData: build.mutation({
      query: (data) => ({
        url: `${VIDEO_URL}/create-video`,
        method: "POST",
        data,
        contentType: "multipart/form-data",
      }),
      invalidatesTags: [tagTypes.VIDEO],
    }),
  }),
});

export const {
  useAddVideoWithFormDataMutation, // upload video
} = videosApi;
