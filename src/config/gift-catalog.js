const giftCatalog = [
  {
    id: 'doraemon-world-flags',
    title: 'Doraemon tìm hiểu xã hội - Các quốc kì trên thế giới',
    description: 'Cùng Doraemon khám phá những lá cờ nhiều màu sắc và tìm hiểu thêm về các quốc gia trên thế giới.',
    image: '/gifts/gift_1785992088270_b0643k.webp',
    price: 80833,
  },
  {
    id: 'science-quiz',
    title: 'Quiz khoa học kì thú - Toán học đố mẹo',
    description: 'Những câu đố vui giúp em rèn tư duy, khám phá khoa học và thấy việc học Toán thú vị hơn.',
    image: '/gifts/gift_1785992288736_jut2jj.webp',
    price: 82500,
  },
  {
    id: 'world-atlas',
    title: 'Atlas thế giới cho trẻ em',
    description: 'Mở cuốn Atlas và bắt đầu chuyến du lịch vòng quanh thế giới qua bản đồ và những kiến thức bổ ích.',
    image: '/gifts/gift_1785985065318_u6id5h.webp',
    price: 85833,
  },
  {
    id: 'one-piece-3d',
    title: 'Lắp ráp 3D One Piece',
    description: 'Tự tay lắp ráp mô hình One Piece để rèn sự khéo léo, kiên nhẫn và khả năng sáng tạo.',
    image: '/gifts/gift_1785986061693_ea8efr.webp',
    price: 88417,
  },
  {
    id: 'conan-card-game',
    title: 'Bộ cờ chiến thuật Detective Conan',
    description: 'Bộ thẻ nhân vật Conan ngẫu nhiên dành cho những bạn thích sưu tầm và khám phá bất ngờ.',
    image: '/gifts/gift_1785315595817_y22mib.webp',
    price: 89000,
  },
  {
    id: 'rubik-24-sides',
    title: 'Đồ chơi Rubik khối hình lá 24 mặt',
    description: 'Thử thách xoay Rubik độc đáo để rèn tư duy, trí nhớ và sự khéo léo qua từng lần biến đổi.',
    image: '/gifts/gift_1785315788743_j7npdh.webp',
    price: 94500,
  },
  {
    id: 'inochi-water-bottle',
    title: 'Bình nước Inochi nhiều màu',
    description: 'Bình nước nhỏ gọn, an toàn và tiện mang theo trong mỗi buổi học hoặc chuyến đi.',
    image: '/gifts/gift_1785316587503_2di1t2.webp',
    price: 96458,
  },
  {
    id: 'dolphin-puzzle',
    title: 'Tranh xếp hình cá heo 330 mảnh',
    description: 'Vừa giải trí vừa rèn sự tập trung, tư duy và tính kiên nhẫn với bức tranh cá heo sinh động.',
    image: '/gifts/gift_1785319020681_yxa9zd.jpg',
    price: 101917,
  },
  {
    id: 'zootopia-figure',
    title: 'Đồ chơi mô hình Zootopia ngẫu nhiên',
    description: 'Mở hộp và khám phá nhân vật Zootopia đáng yêu để bắt đầu bộ sưu tập của riêng mình.',
    image: '/gifts/gift_1785320372449_b8jf7c.jpg',
    price: 103417,
  },
  {
    id: 'english-mind-map',
    title: 'Ngữ pháp tiếng Anh bằng sơ đồ tư duy',
    description: 'Học ngữ pháp trực quan hơn với những sơ đồ dễ nhớ, dễ tra cứu và dễ áp dụng.',
    image: '/gifts/gift_1785990444381_lg59sg.webp',
    price: 212917,
  },
  {
    id: 'chess-set',
    title: 'Cờ vua Hoàng Gia',
    description: 'Bộ cờ gọn gàng giúp em rèn tư duy chiến thuật, sự tập trung và khả năng lập kế hoạch.',
    image: '/gifts/gift_1785316664821_guy8y5.jpg',
    price: 154167,
  },
  {
    id: 'uno-card-game',
    title: 'Đồ chơi cờ trí tuệ UNO',
    description: 'Trò chơi vui nhộn để rèn phản xạ và xử lý tình huống cùng bạn bè hoặc gia đình.',
    image: '/gifts/gift_1785316814567_hrdp4u.jpg',
    price: 155917,
  },
  {
    id: 'thien-long-gel-pens',
    title: 'Hộp bút gel Thiên Long - Mực xanh',
    description: 'Những chiếc bút gel viết êm, mực đẹp và thiết kế vui nhộn giúp mỗi giờ học thêm nhiều cảm hứng.',
    image: '/gifts/gift_1785991786482_hezijc.webp',
    price: 87250,
  },
];

const getGiftById = giftId => giftCatalog.find(gift => gift.id === giftId);

module.exports = { giftCatalog, getGiftById };
