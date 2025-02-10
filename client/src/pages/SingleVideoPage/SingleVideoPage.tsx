import RecommendedVideo from "@/components/shared/RecommendedVideo/RecommendedVideo";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

const SingleVideoPage = () => {
  const { id } = useParams();

  const [data, setData] = useState([]);
  const [video, setVideo] = useState(null);
  const [showFullDescription, setShowFullDescription] = useState(false);

  const toggleDescription = () => {
    setShowFullDescription(!showFullDescription);
  };

  useEffect(() => {
    fetch("../../../public/data.json")
      .then((res) => res.json())
      .then((data) => setData(data));
  }, []);

  useEffect(() => {
    if (data.length) {
      const selectedVideo = data.find((v) => v._id === id);
      setVideo(selectedVideo);
    }
  }, [data, id]);

  return (
    <div className="w-full flex justify-between items-start gap-2 p-4">
      <div className="w-[70%] flex flex-col justify-center items-start">
        <iframe
          style={{ boxShadow: "0 0 8px 8px rgba(0, 255, 0, 0.7)" }}
          className=""
          width="100%"
          height="720"
          src={video?.url}
          title="YouTube video player"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
        <h1 className="text-xl font-bold my-3">{video?.title}</h1>
        <div className="flex justify-center items-center gap-3">
          <img
            className="h-12 w-12 rounded-full object-cover object-center mt-2"
            src={video?.channel?.profilePicture}
            alt="blog"
          />
          <div className="flex justify-center items-center gap-3">
            <div>
              {" "}
              <h1 className="font-bold text-lg">{video?.channel?.name}</h1>
              <p className="text-gray-400">
                {video?.channel?.subscribedCount}k subscribers
              </p>
            </div>

            <button
              className="bg-black px-4 py-1.5
             text-white rounded-full font-bold"
            >
              Subscribe
            </button>
          </div>
        </div>

        <div className="bg-neutral-300 w-full mt-3 rounded-md p-3">
          <h1>
            {video?.viewCount}views, Uploaded at {video?.uploadAt}
          </h1>

          <p>
            {showFullDescription || video?.videoDescription.length <= 500
              ? video?.videoDescription
              : `${video?.videoDescription.substring(0, 300)}...`}
          </p>
          {video?.videoDescription.length > 300 && (
            <button onClick={toggleDescription}>
              {showFullDescription ? "Show Less" : "See More"}
            </button>
          )}
        </div>
      </div>
      <div className="w-[30%]  flex justify-center items-center px-4">
        <div className="grid grid-cols-1 -m-4 pt-1">
          {data?.slice(0, 5).map((content: any) => (
            <Link to={`/video/${content._id}`}>
              <RecommendedVideo content={content} key={content?._id} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SingleVideoPage;
