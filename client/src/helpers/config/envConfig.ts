export const getBaseUrl = (): string => {
  return process.env.VITE_API_URL || "http://localhost:5000/api/v1";
};

export const getImgBBUrl = (): string => {
  const imgBBUrl =
    import.meta.env.imgBB_KEY as string|| "3e7c5c0cd1ac6a06dc8f8e896ce3a95c";
  console.log(imgBBUrl);
  return imgBBUrl;
};
