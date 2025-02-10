import Video from "@/components/Home/Video/Video";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type IChannelType = {
  name: string;
  profilePicture: string;
  coverPhoto: string;
};

type IVideoType = {
  _id: string;
  url: string;
  tag: string[];
  category: string;
  thumbnail: string;
  title: string;
  uploadAt: string;
  viewCount: number;
  comments: any[];
  channel: IChannelType;
};

const Home = () => {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("data.json");
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const jsonData = await response.json();
        setData(jsonData);
      } catch (error) {
        console.error("There was a problem with the fetch operation:", error);
      }
    };

    fetchData();
  }, []);
  console.log(data);
  return (
    <div>
      <section className="text-gray-600 body-font">
        <div className="px-5 my-5 mx-auto">
          <div className="grid grid-cols-5 -m-4">
            {data?.map((content: IVideoType) => (
              <Link to={`/video/${content._id}`}>
                <Video content={content} key={content?._id} />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
