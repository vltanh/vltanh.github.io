// get the ninja-keys element
const ninja = document.querySelector('ninja-keys');

// add the home and posts menu items
ninja.data = [{
    id: "nav-about",
    title: "about",
    section: "Navigation",
    handler: () => {
      window.location.href = "/";
    },
  },{id: "nav-blog",
          title: "blog",
          description: "Notes in Vietnamese and English on mathematics, machine learning, algorithms, and occasional CTF write-ups by The-Anh Vu-Le.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/blog/";
          },
        },{id: "nav-publications",
          title: "publications",
          description: "Publications by The-Anh Vu-Le on network science, community detection, graph algorithms, machine learning, and computer vision.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/publications/";
          },
        },{id: "nav-projects",
          title: "projects",
          description: "Research and personal software projects by The-Anh Vu-Le, spanning network science, formalized mathematics, and computational experiments.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/projects/";
          },
        },{id: "nav-cv",
          title: "CV",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/cv/";
          },
        },{id: "nav-repositories",
          title: "repositories",
          description: "Open-source research software and personal coding projects by The-Anh Vu-Le.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/repositories/";
          },
        },{id: "post-trại-súc-vật",
        
          title: "Trại súc vật",
        
        description: "",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2026/trai-suc-vat/";
          
        },
      },{id: "post-chia-đôi-một-góc",
        
          title: "Chia đôi một góc",
        
        description: "Dựng đường phân giác bằng thước thẳng và compa theo phương pháp cổ điển và đại số, rồi mở rộng sang căn bậc hai số phức và chia ba góc.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2025/bisect-an-angle/";
          
        },
      },{id: "post-giải-bài-toán-quy-hoạch-tuyến-tính-với-scipy",
        
          title: "Giải bài toán quy hoạch tuyến tính với SciPy",
        
        description: "Hướng dẫn mô hình hóa và giải bài toán quy hoạch tuyến tính với scipy.optimize.linprog, kèm ví dụ và bài tập về luồng, lập lịch, và xếp nhóm.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/lp-scipy/";
          
        },
      },{id: "post-suy-diễn-biến-phân-phần-2",
        
          title: "Suy diễn Biến phân (Phần 2)",
        
        description: "Mở rộng suy diễn biến phân sang mô hình phân tầng bằng giả định trường trung bình, cập nhật theo tọa độ, và thuật toán CAVI.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/vi-2/";
          
        },
      },{id: "post-suy-diễn-biến-phân-phần-1",
        
          title: "Suy diễn Biến phân (Phần 1)",
        
        description: "Nhập môn suy diễn biến phân qua một mô hình tuổi thọ bóng đèn, tiêu chí Kullback-Leibler, ELBO, và lựa chọn họ phân phối xấp xỉ.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/vi-1/";
          
        },
      },{id: "post-máy-boltzmann-phần-1",
        
          title: "Máy Boltzmann (Phần 1)",
        
        description: "Tổng quan về mô hình năng lượng, máy Boltzmann, máy Boltzmann giới hạn, và cách xấp xỉ mean-field tạo chặn dưới biến phân.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2023/bm-rbm-meanfield/";
          
        },
      },{id: "post-chọn-ngẫu-nhiên-điểm-trong-hình-tròn",
        
          title: "Chọn ngẫu nhiên điểm trong hình tròn",
        
        description: "Vì sao lấy bán kính đều không tạo ra điểm đều trong hình tròn, và cách sửa bằng lấy mẫu nghịch đảo hoặc lấy mẫu từ chối.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2022/ngau-nhien-hinh-tron/";
          
        },
      },{id: "post-hồi-quy-softmax-hay-tôi-đã-tốn-một-buổi-chiều-thứ-tư-như-thế-nào",
        
          title: "Hồi quy Softmax hay Tôi đã tốn một buổi chiều thứ Tư như...",
        
        description: "Xây dựng hồi quy Softmax cho bài toán phân lớp đơn nhãn, từ hàm mất mát cross-entropy đến lan truyền xuôi, lan truyền ngược, và cài đặt.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2021/hoi-quy-softmax/";
          
        },
      },{id: "post-write-up-for-hcmus-ctf-warm-up-stage",
        
          title: "Write-up for HCMUS-CTF Warm-Up Stage",
        
        description: "Solutions and walkthroughs for the Misc, Forensics, Cryptography, Web, Pwn, and Reverse Engineering challenges from the HCMUS-CTF Warm-Up Stage.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2020/hcmus-ctf-warm-up/";
          
        },
      },{id: "post-được-ăn-cả-ngã-về-không",
        
          title: "Được ăn cả, ngã về không",
        
        description: "So sánh chiến thuật đặt cược thận trọng và tất tay trong bài toán phá sản của con bạc bằng xác suất hấp thụ của chuỗi Markov.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2020/duoc-an-ca-nga-ve-khong/";
          
        },
      },{id: "post-nên-đánh-hay-nên-hòa",
        
          title: "Nên đánh hay nên hòa",
        
        description: "Giới thiệu phân tích cạnh tranh qua bài toán thuê ván trượt, từ chiến thuật tất định đến chiến thuật ngẫu nhiên tối ưu.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2019/nen-danh-hay-nen-hoa/";
          
        },
      },{id: "post-hai-thế-giới",
        
          title: "Hai thế giới",
        
        description: "Dùng bài toán ném xiên để tìm đường bao của các quỹ đạo và giải thích ranh giới cong giữa hai miền trong một bức tranh giả tưởng.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2019/hai-the-gioi/";
          
        },
      },{id: "post-sức-mạnh-của-kẻ-yếu",
        
          title: "Sức mạnh của kẻ yếu",
        
        description: "Phân tích bài toán đấu súng ba người và nghịch lý chiến lược giúp xạ thủ yếu nhất có cơ hội sống sót cao nhất.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2019/suc-manh-cua-ke-yeu/";
          
        },
      },{id: "news-the-start-of-a-new-blog-sparkle",
          title: 'The start of a new blog! :sparkle:',
          description: "",
          section: "News",},{id: "news-1-paper-groundedbert-accepted-to-acm-multimedia-2023",
          title: '1 paper (GroundedBERT) accepted to ACM Multimedia 2023',
          description: "",
          section: "News",},{id: "news-2-papers-sbm-wcc-reccs-accepted-to-complex-networks-amp-amp-their-applications-2024",
          title: '2 papers (SBM+WCC, RECCS) accepted to Complex Networks &amp;amp;amp; Their Applications 2024',
          description: "",
          section: "News",},{id: "news-passed-the-phd-qualifying-exam",
          title: 'Passed the PhD Qualifying Exam! 🎉',
          description: "",
          section: "News",},{id: "news-ec-sbm-has-been-accepted-for-publication-in-the-journal-applied-network-science",
          title: 'EC-SBM has been accepted for publication in the journal Applied Network Science',
          description: "",
          section: "News",},{id: "news-reccs-has-been-accepted-for-publication-in-the-journal-advances-in-complex-systems",
          title: 'RECCS has been accepted for publication in the journal Advances in Complex Systems...',
          description: "",
          section: "News",},{id: "news-earned-my-master-s-degree-at-uiuc-don-t-worry-i-am-still-working-towards-my-phd-s-degree",
          title: 'Earned my Master’s Degree at UIUC! Don’t worry, I am still working towards...',
          description: "",
          section: "News",},{id: "news-2-papers-dsc-sasca-s-accepted-to-complex-networks-amp-amp-their-applications-2025",
          title: '2 papers (DSC, SASCA-s) accepted to Complex Networks &amp;amp;amp; Their Applications 2025',
          description: "",
          section: "News",},{id: "news-sbm-wcc-has-been-accepted-for-publication-in-the-journal-applied-network-science",
          title: 'SBM+WCC has been accepted for publication in the journal Applied Network Science',
          description: "",
          section: "News",},{id: "news-with-3-internship-offers-for-the-summer-of-2026-i-am-thrilled-to-announce-that-i-will-be-joining-google-as-a-phd-software-engineer-intern-working-on-clock-synchronization-algorithms-for-data-centers",
          title: 'With 3 internship offers for the summer of 2026, I am thrilled to...',
          description: "",
          section: "News",},{id: "news-i-am-now-happily-married-to-my-beloved-partner-mai-heart-eyes",
          title: 'I am now happily married to my beloved partner, Mai. :heart_eyes:',
          description: "",
          section: "News",},{id: "projects-chess-monte-carlo-simulation",
          title: 'Chess Monte Carlo Simulation',
          description: "Tracking the 2026 Candidates with dynamic player strength, one million simulated tournaments per round.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/chess-monte-carlo-simulation/";
            },},{id: "projects-formalization-of-tao-39-s-analysis-i-in-lean-4",
          title: 'Formalization of Tao&amp;#39;s Analysis I in Lean 4',
          description: "A from-the-axioms-up Lean 4 formalization of Terence Tao&#39;s Analysis I, covering both the main text and the exercises with no outside libraries.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/lean4-analysis-tao/";
            },},{id: "projects-synthetic-network-generators",
          title: 'Synthetic Network Generators',
          description: "A pipeline-unified gallery of community-aware synthetic network generators, each illustrated stage by stage on the same small example.",
          section: "Projects",handler: () => {
              window.location.href = "/projects/network-generation/";
            },},{
        id: 'social-discord',
        title: 'Discord',
        section: 'Socials',
        handler: () => {
          window.open("https://discord.com/users/391073383875346432", "_blank");
        },
      },{
        id: 'social-email',
        title: 'email',
        section: 'Socials',
        handler: () => {
          window.open("mailto:%76%6C%74%61%6E%68@%69%6C%6C%69%6E%6F%69%73.%65%64%75", "_blank");
        },
      },{
        id: 'social-facebook',
        title: 'Facebook',
        section: 'Socials',
        handler: () => {
          window.open("https://facebook.com/vltanh", "_blank");
        },
      },{
        id: 'social-github',
        title: 'GitHub',
        section: 'Socials',
        handler: () => {
          window.open("https://github.com/vltanh", "_blank");
        },
      },{
        id: 'social-linkedin',
        title: 'LinkedIn',
        section: 'Socials',
        handler: () => {
          window.open("https://www.linkedin.com/in/vltanh", "_blank");
        },
      },{
        id: 'social-scholar',
        title: 'Google Scholar',
        section: 'Socials',
        handler: () => {
          window.open("https://scholar.google.com/citations?user=FI3KRtkAAAAJ", "_blank");
        },
      },{
      id: 'light-theme',
      title: 'Change theme to light',
      description: 'Change the theme of the site to Light',
      section: 'Theme',
      handler: () => {
        setThemeSetting("light");
      },
    },
    {
      id: 'dark-theme',
      title: 'Change theme to dark',
      description: 'Change the theme of the site to Dark',
      section: 'Theme',
      handler: () => {
        setThemeSetting("dark");
      },
    },
    {
      id: 'system-theme',
      title: 'Use system default theme',
      description: 'Change the theme of the site to System Default',
      section: 'Theme',
      handler: () => {
        setThemeSetting("system");
      },
    },];
