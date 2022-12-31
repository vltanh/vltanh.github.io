---
layout: distill
title: Sức mạnh của kẻ yếu
date: 2019-03-29
description:
tags: math
categories:
giscus_comments: true 

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name: 
toc:
  - name: Bối cảnh
  - name: Phân tích
---

## Bối cảnh

Ở một vùng đất giả tưởng nọ tồn tại **3 quốc gia, Đỏ, Lam và Vàng**. Ba quốc gia này luôn so kè với nhau để giành quyền kiểm soát vùng đất trung tâm, nơi có trữ lượng tài nguyên vô cùng lớn. Người dân của mỗi quốc gia có những đặc trưng đáng tự hào của riêng mình. Với Đỏ, đó là bản lĩnh và sức mạnh lấn át. Với Vàng, đó là sự nhanh nhạy và chính xác. Còn với Lam, đó là tinh thần đoàn kết và bao dung.

Tranh chấp kéo dài đã dẫn đến kết quả không thể tránh khỏi: một cuộc đối đầu trực tiếp giữa ba quốc gia. Họ giao kèo với nhau, mỗi bên sẽ cử ra **1 xạ thủ** giỏi nhất của mình để tham gia một trận đấu sinh tử. Đề nghị này rõ ràng là bất lợi với Lam, vốn sức mạnh nằm ở tập thể chứ không phải cá nhân. Tuy nhiên, là một quốc gia yếu thế và hài hòa, Lam chấp nhận với điều kiện họ là người sẽ quyết định hình thức thi đấu. Tất nhiên hình thức sẽ chỉ được chốt khi đạt được sự đồng thuận của 3 nước.

Đỏ nhanh chóng tìm ra xạ thủ phù hợp, đó là một tay súng cừ khôi, với khả năng bắn trúng mục tiêu lên đến **80%**. Vàng lúc này vô cùng đắc chí, bởi họ đã có trong tay quân át chủ bài cực mạnh. Xạ thủ Vàng là một xạ thủ lành nghề, cộng thêm bản tính nhanh nhạy và chính xác đặc trưng của quốc gia, anh có thể “bách phát bách trúng”, tức **100%**. Về phía Lam, dù đã rất cố gắng tìm kiếm, họ cũng đành đặt cược hết vào anh xạ thủ lai, là sản phẩm của một mối tình trắc trở giữa chàng trai Lam và cô gái Vàng. Kể cả vậy, khả năng bắn trúng của anh chỉ ở **50%**.

Tuy thế, Lam vẫn không bỏ cuộc. Họ vẫn còn một kế sách cuối cùng, nằm ở việc quyết định hình thức thi đấu. Sau khi nghiên cứu tính toán dựa trên các thông tin mật thu được về xạ thủ của các quốc gia, họ đề xuất:

- Ba xạ thủ sẽ không bắn cùng lúc mà sẽ lần lượt bắn theo thứ tự **Lam - Đỏ - Vàng**.
- Ở lượt bắn của mình, xạ thủ chỉ được nhắm **tối đa 1 người** và bắn **1 viên đạn duy nhất** (tức có thể bỏ lượt).
- Loại súng sử dụng sẽ là loại súng không gây sát thương chết người. Tuy nhiên, **người bị bắn trúng sẽ ngay lập tức bị loại khỏi cuộc chơi**.

Suy xét kỹ lưỡng, hai quốc gia còn lại nhận định thứ tự bắn như vậy là không công bằng. Lam cho rằng thứ tự như vậy là ưu tiên người yếu hơn, do đó hợp lý ở một khía cạnh nào đó. Kì kèo qua lại, ba quốc gia đồng thuận: thứ tự bắn sẽ được quyết định bằng một viên xúc xắc chuẩn (xác suất ra mỗi mặt là 1/6).

Và thế là cuộc đấu bắt đầu...

## Phân tích

Ở đây, ta ký hiệu xạ thủ Lam, Đỏ, Vàng lần lượt là L, D và V.

Đầu tiên, chúng ta biết xác suất bắn trúng và trật của mỗi người là:

- $$P(L \text{ trúng}) = 0.5, P(L \text{ hụt}) = 0.5$$;
- $$P(D \text{ trúng}) = 0.8, P(D \text{ hụt}) = 0.2$$;
- $$P(V \text{ trúng}) = 1.0, P(V \text{ hụt}) = 0.0$$.

Gọi $P(S\mid XYZ)$ là xác suất người S thắng khi thứ tự bắn hiện tại là XYZ. Ví dụ $P(L\mid LDV)$ nghĩa là xác suất xạ thủ L sống sót khi thứ tự bắn hiện tại là Lam rồi đến Đỏ rồi đến Vàng.

Ta tính các xác suất thắng khi chỉ còn hai người chơi, tức các thứ tự có thể có là VL, VD, DV, DL, LD, LV. Lưu ý rằng khi chỉ còn hai người chơi thì không ai có lý do gì để bỏ lượt vì làm vậy sẽ chỉ tạo điều kiện thắng cho đối phương.

- VL: do Vàng không bao giờ bắn trật nên
  - Vàng chắc chắn thắng do Vàng chắc chắn sẽ bắn trúng Lam, $P(V \mid VL) = 1$;
  - Đỏ đã bị loại nên không thể thắng, $P(D \mid VL) = 0$;
  - Lam không có khả năng thắng do chắc chắn bị Vàng bắn trúng, $P(L \mid VL) = 0$.
- VD: tương tự trên, $P(V \mid VD) = 1, P(D \mid VD) = P(L \mid VD) = 0$.
- DV: Đỏ nhắm bắn Vàng. Nếu Đỏ trúng (xác suất 0.8), Đỏ thắng. Nếu Đỏ trật, thứ tự bắn chuyển thành VD.
  - $P(V \mid DV) = 0.8 \times 0 + 0.2  P(V \mid VD) = 0.2$;
  - $P(D \mid DV) = 0.8 \times 1 + 0.2  P(D \mid VD) = 0.8$;
  - $P(L \mid DV) = 0$.
- DL: Đỏ nhắm bắn Lam. Tương tự, 0.8 khả năng Đỏ thắng và 0.2 khả năng thứ tự trở thành LD. Lúc này, Lam sẽ nhắm Đỏ, với 0.5 khả năng Lam thắng và 0.5 khả năng thứ tự quay lại DL.
  - $P(V \mid DL) = 0$;
  - $P(D \mid DL) = 0.8 \times 1 + 0.2  P(D \mid LD)$

  $= 0.8 + 0.2 [0.5 \times 0 + 0.5  P(D \mid DL)]$

  $\Rightarrow P(D \mid DL) = 8/9$;
  - $P(L \mid DL) = 0.8 \times 0 + 0.2  P(L \mid LD)$
  
  $= 0.2 [0.5 \times 1 + 0.5  P(L \mid DL)]$
  
  $\Rightarrow P(L \mid DL) = 1/9$.
- LD: Lam sẽ bắn Đỏ, với 0.5 khả năng Lam thắng và 0.5 khả năng thứ tự trở thành DL.
  - \$P(V \mid LD) = 0\$;
  - $P(D \mid LD) = 0.5 \times 0 + 0.5 P(D \mid DL) = 4/9$;
  - $P(L \mid LD) = 0.5 \times 1 + 0.5 P(L \mid DL) = 5/9$.
- LV: Lam sẽ bắn Vàng, với 0.5 khả năng Lam thắng và 0.5 khả năng thứ tự trở thành VL.
  - $P(V \mid LV) = 0.5 \times 0 + 0.5 P(V \mid VL) = 0.5$;
  - $P(D \mid LV) = 0$;
  - $P(L \mid LV) = 0.5 \times 1 + 0.5 P(L \mid VL) = 0.5$.

Ta tổng kết lại thành bảng sau:

|        | **V** | **D** | **L** |
|--------|-------|-------|-------|
| **VL** |   1   |   0   |   0   |
| **VD** |   1   |   0   |   0   |
| **DV** |  1/5  |  4/5  |   0   |
| **DL** |   0   |  8/9  |  1/9  |
| **LD** |   0   |  4/9  |  5/9  |
| **LV** |  1/2  |   0   |  1/2  |

Dựa vào kết quả trên, ta tính xác suất thắng cho ba người bằng cách tính xác suất thắng cho xạ thủ đầu tiên trong thứ tự bắn, với mỗi xạ thủ có 3 lựa chọn là bắn 1 trong 2 người còn lại hoặc bỏ lượt. Có $3! = 6$ thứ tự bắn có thể VDL, VLD, DVL, LVD, DLV, LDV.

- VDL:

  - Nếu Vàng bắn Đỏ, chắc chắn Đỏ bị loại, thứ tự trở thành LV. $P(V \mid VDL) = P(V \mid LV) = 0.5$;
  - Nếu Vàng bắn Lam, chắc chắn Lam bị loại, thứ tự trở thành DV. $P(V \mid VDL) = P(V \mid DV) = 0.2$;
  - Nếu Vàng bỏ lượt, thứ tự trở thành DLV. Đỏ có 3 lựa chọn lúc này: hoặc bắn Vàng, hoặc bắn Lam, hoặc bỏ lượt. Nếu bắn trật hoặc bỏ lượt, thự tự đều chuyển thành LVD. Nếu bắn trúng Lam, thứ tự chuyển thành VD và khi đó Đỏ chắc chắn thua. Nếu bắn trúng Vàng, thứ tự chuyển thành LD, chỉ có 50% khả năng là bị Lam bắn trúng. Như vậy, Đỏ sẽ bắn Vàng và khi đó

  $$
    P(V \mid VDL) = P(V \mid DLV) = 0.2 P(V \mid LVD) < 0.5.
  $$

  - Như vậy chiến thuật tốt nhất của Vàng là bắn Đỏ, khi đó:
    - $P(V \mid VDL) = P(V \mid LV) = 0.5$;
    - $P(D \mid VDL) = P(D \mid LV) = 0$;
    - $P(L \mid VDL) = P(L \mid LV) = 0.5$.

- VLD: cũng với lập luận tương tự trên, ta có chiến thuật tốt nhất của Vàng vẫn là bắn Đỏ, khi đó:

$$
    P(V \mid VLD) = P(L \mid VLD) = 0.5, P(D \mid VLD) = 0.
$$

- DVL:

  - Nếu Đỏ bắn Vàng,

    $$
        P(D \mid DVL) = 0.8 P(D \mid LD) + 0.2 P(D \mid VLD) = 16/45;
    $$

  - Nếu Đỏ bắn Lam,

    $$
        P(D \mid DVL) = 0.8 P(D \mid VD) + 0.2 P(D \mid VLD) = 0;
    $$

  - Nếu Đỏ bỏ lượt, $P(D \mid DVL) = P(D \mid VDL) = 0$;
  - Như vậy, chiến thuật toát nhất của Đỏ là bắn Vàng, khi đó:
    - $P(V \mid DVL) = 0.8 P(V \mid LD) + 0.2 P(V \mid VLD) = 0.1$;
    - $P(D \mid DVL) = 16/45$;
    - $P(L \mid DVL) = 0.8 P(L \mid LD) + 0.2 P(L \mid VLD) = 49/90$.

- DLV: tương tự trường hợp DVL, chiến thuật tốt nhất của Đỏ là bắn Vàng, có $P(V \mid DLV) = 0.1, P(D \mid DLV) = 16/45, P(L \mid DVL) = 49/90$.
- LVD:
  - Nếu Lam bắn Vàng, $P(L \mid LVD) = 0.5 P(L \mid DL) + 0.5 P(L \mid VDL) = 11/36$;
  - Nếu Lam bắn Đỏ, $P(L \mid LVD) = 0.5 P(L \mid VL) + 0.5 P(L \mid VDL) = 0.25$;
  - Nếu Lam bỏ lượt, $P(L \mid LVD) = P(L \mid VDL) = 0.5$.
  - Như vậy, chiến thuật tốt nhất của Lam là bỏ lượt, khi đó:
    - $P(V \mid LVD) = P(V \mid VDL) = 0.5$;
    - $P(D \mid LVD) = P(D \mid VDL) = 0$;
    - $P(L \mid LVD) = P(L \mid VDL) = 0.5$.
- LDV: tương tự trường hợp LVD, chiến thuật tốt nhất của Lam là bỏ lượt, có $P(V \mid LDV) = 0.1, P(D \mid LDV) = 16/45, P(L \mid LDV) = 49/90$.

Ta tổng kết lại thành bảng:

|                   | **V** | **D** | **L** |
|-------------------|-------|-------|-------|
| **VDL, VLD, LVD** |  1/2  |   0   |  1/2  |
| **DVL, DLV, LDV** |  1/10 | 16/45 | 49/90 |

Với việc gieo xúc xắc để quyết định 1 trong 6 thứ tự trên, ta có xác suất thắng của xạ thủ là:

- $$P(V \text{ thắng}) = 0.5 \times 1/2 + 0.5 \times 1/10 = 0.3$$;
- $$P(D \text{ thắng}) = 0.5 \times 0 + 0.5 \times 16/45 = 8/45 \approx 0.1778$$;
- $$P(L \text{ thắng}) = 0.5 \times 1/2 + 0.5 \times 49/90 = 27/90 \approx 0.5222$$.

Như vậy, tuy là quốc gia yếu nhất, nhưng Lam vẫn có khả năng thắng cao cách biệt so với hai nước còn lại nếu chọn chiến thuật hợp lý. Một cách giải thích đơn giản cho việc này nằm ở việc, khi chơi tối ưu để sống sót, mỗi xạ thủ sẽ hướng đến việc trừ khử xạ thủ nguy hiểm hơn trong 2 xạ thủ đối phương. Chính do Lam là quốc gia yếu nhất nên Lam sẽ không bị nhắm đến cho đến khi hoặc Đỏ hoặc Vàng bị loại, và đặc biệt lúc đó Lam cũng có lợi thế đến lượt bắn. Quả nhiên với bộ 3 giá trị xác suất này thì Lam sẽ có được xác suất chiến thắng cao.

Ở những phần tới (nếu có), chúng ta sẽ đi qua một số hướng tiếp cận khác (nếu được), cũng như cố gắng tổng quát hóa cho bộ 3 giá trị xác suất bất kì (nếu được).

Còn tiếp (mong là vậy)...

## Tham khảo

- [Truel](https://en.wikipedia.org/wiki/Truel), Wikipedia
- [The Truel](https://puzzle.dse.nl/teasers/index_us.html#the_truel), The Ultimate Puzzle and Riddle Site
