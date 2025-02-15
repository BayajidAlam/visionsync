ffmpeg -i input.mp4 \
    -filter_complex "[0:v]split=4[v1][v2][v3][v4]; \
        [v1]scale=1920:1080[v1out]; \
        [v2]scale=1280:720[v2out]; \
        [v3]scale=854:480[v3out]; \
        [v4]scale=640:360[v4out]" \
    -map "[v1out]" -c:v:0 libx264 -b:v:0 5000k -preset fast \
    -map "[v2out]" -c:v:1 libx264 -b:v:1 3000k -preset fast \
    -map "[v3out]" -c:v:2 libx264 -b:v:2 1500k -preset fast \
    -map "[v4out]" -c:v:3 libx264 -b:v:3 800k -preset fast \
    -map 0:a:0? -c:a aac -b:a 128k -ar 48000 \
    -g 48 -sc_threshold 0 -keyint_min 48 \
    -adaptation_sets "id=0,streams=v id=1,streams=a" \
    -f dash -seg_duration 10 -init_seg_name "init-\$RepresentationID\$.m4s" -media_seg_name "chunk-\$RepresentationID\$-\$Number\$.m4s" \
    output/manifest.mpd
