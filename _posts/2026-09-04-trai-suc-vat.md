---
layout: distill
title: Trại súc vật
date: 2026-09-04
description: 
lang: vi
math: true
zoomable: true
og_image: 
tags: math
categories:
giscus_comments: true

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name: UIUC
toc:
  - name: Câu hỏi
  - name: Giải pháp đầu tiên
  - name: Giải pháp thứ hai
    subsections:
      - name: Mô phỏng hai băng chuyền
      - name: Ghép cặp trực tiếp
  - name: Giải pháp thứ ba
---

> **Miễn trừ trách nhiệm**: Đây là một sản phẩm hư cấu. Tên, nhân vật, công ty, địa điểm, sự kiện đều hoặc là sản phẩm của trí tưởng tượng của tác giả hoặc được sử dụng với ý nghĩa hư cấu. Mọi tương đồng với những người, còn sống hay đã chết, hoặc với những sự kiện thực tế đều là trùng hợp ngẫu nhiên.

## Câu hỏi

Thế Anh sở hữu một trang trại nuôi nhiều gia súc, gia cầm. Trong số đó, gà và lợn vừa chiếm số lượng áp đảo, vừa đặc biệt quấn quít lấy nhau. Để trang trại luôn ngập tràn niềm vui, Thế Anh muốn giữ cho số gà và số lợn bằng nhau. Nhưng công việc kinh doanh đòi hỏi anh thường xuyên bán bớt một số con và mua thêm những con khác. Vì thế, hằng ngày, Thế Anh đều phải trả lời một câu hỏi: với một nhóm gà và lợn bất kì, liệu số con của hai loài có bằng nhau không?

Dĩ nhiên, đây là một việc quá đơn giản: chẳng cần là thần đồng số học cũng có thể đếm số gà, số lợn rồi so sánh. Tuy nhiên, do nghỉ học từ nhỏ, Thế Anh lại không biết đếm. Bỗng dưng, bài toán trở nên khó khăn hơn nhiều.

Thế Anh tìm đến Mai, một kỹ sư dữ liệu giàu kinh nghiệm, để nhờ thiết kế một hệ thống giúp mình làm việc này. Suy nghĩ đầu tiên của Mai là đưa cho anh một chiếc máy đếm. Nhưng có gì vui trong giải pháp đó cơ chứ? Sau một hồi suy nghĩ, Mai đưa ra một thiết kế khác.

## Giải pháp đầu tiên

Mai thiết kế một hệ thống gồm một bộ điều khiển và hai băng chuyền.

Mỗi băng chuyền được chia thành các ô liên tiếp và được coi là có thể kéo dài tùy ý về bên phải. Mỗi ô chứa tối đa một con vật hoặc một vật đánh dấu. Khi chuẩn bị đầu vào, các con vật và vật đánh dấu được đặt liền nhau từ đầu băng, không có ô trống xen giữa; phía sau là các ô trống. Trong lúc hệ thống hoạt động, mọi con vật và vật đánh dấu đều ở nguyên ô của mình.

Phía trên mỗi băng chuyền có một chiếc máy ảnh. Máy ảnh chỉ quan sát được ô ngay bên dưới. Nó có thể dịch sang trái một ô, sang phải một ô hoặc giữ nguyên vị trí, nhưng không được đi qua mép trái của băng chuyền.

Bộ điều khiển có một số hữu hạn trạng thái. Nó không lưu ảnh, không có sẵn bộ đếm và cũng không có bộ nhớ riêng để ghi lại một lượng thông tin tăng theo số con vật. Mọi thông tin cần giữ lại giữa các bước đều phải được thể hiện bằng trạng thái hiện tại. Chương trình và số trạng thái được cố định từ trước, không thay đổi theo kích thước nhóm cần kiểm tra. Trong mỗi bước, bộ điều khiển căn cứ vào trạng thái hiện tại và những gì hai máy ảnh đang nhìn thấy để xác định trạng thái kế tiếp (có thể giống với trạng thái hiện tại), đồng thời ra lệnh di chuyển cho từng máy ảnh.

Trong các trạng thái, có hai trạng thái đặc biệt. Đầu tiên là trạng thái chấp nhận, nghĩa là bộ điều khiển sẽ thông báo rằng số lượng gà và lợn trên băng chuyền là bằng nhau. Trạng thái đặc biệt thứ hai là trạng thái từ chối, nghĩa là bộ điều khiển sẽ thông báo rằng số lượng gà và lợn trên băng chuyền là không bằng nhau. Khi bộ điều khiển chuyển sang một trong hai trạng thái đặc biệt này, nó sẽ dừng lại và không thực hiện thêm bất kì thao tác nào nữa.

Để kiểm tra một nhóm con vật, Mai hướng dẫn Thế Anh đặt tất cả các con gà lên băng chuyền thứ nhất và tất cả các con lợn lên băng chuyền thứ hai. Hai máy ảnh cùng bắt đầu ở ô đầu tiên của mỗi băng; nếu một loài không có con nào, ô đầu tiên của băng tương ứng là ô trống.

Chương trình rất đơn giản. Nếu máy ảnh thứ nhất nhìn thấy gà và máy ảnh thứ hai nhìn thấy lợn, bộ điều khiển sẽ điều khiển cả hai máy ảnh di chuyển sang phải một ô. Nếu một bên nhìn thấy con vật còn bên kia nhìn thấy ô trống, tức là số lượng con vật của hai loài không bằng nhau, bộ điều khiển sẽ chuyển sang trạng thái từ chối và dừng lại. Nếu cả hai cùng nhìn thấy ô trống, tức là số lượng con vật của hai loài là bằng nhau, bộ điều khiển sẽ chuyển sang trạng thái chấp nhận và dừng lại.

Nghe xong, Thế Anh rất hài lòng và lập tức nhờ Mai xây dựng hệ thống. Nhưng Mai vẫn còn băn khoăn: hai băng chuyền, nhất là hai chiếc máy ảnh, có vẻ hơi tốn kém. Cô muốn tìm một phương án kinh tế hơn. Sau một hồi suy nghĩ, Mai đưa ra thiết kế mới.

## Giải pháp thứ hai

### Mô phỏng hai băng chuyền

Lần này, hệ thống chỉ có một băng chuyền và một máy ảnh. Đổi lại, máy ảnh được gắn thêm thiết bị dán và tháo nhãn. Thiết bị chỉ tác động lên vật trong ô ngay bên dưới máy ảnh. Trong một bước, sau khi đọc ô hiện tại, bộ điều khiển có thể ra lệnh dán nhãn, tháo nhãn hoặc giữ nguyên, rồi cho máy ảnh di chuyển hoặc đứng yên. Ý tưởng của Mai là dùng hệ thống này để mô phỏng chương trình so sánh trên hai băng chuyền.

Trên băng duy nhất, cô đặt lần lượt một hòn đá mốc ở đầu, tất cả các con gà, một hòn đá phân cách, tất cả các con lợn và một hòn đá kết thúc. Hòn đá mốc có hình dạng riêng để máy ảnh phân biệt nó với hai hòn đá còn lại. Nếu một loài không có con nào, hai hòn đá giới hạn đoạn của loài đó nằm cạnh nhau.

Mỗi đoạn có một nhãn đánh dấu vị trí máy ảnh tương ứng trong hệ thống hai băng. Ban đầu, nhãn nằm trên con vật đầu tiên của đoạn; nếu đoạn rỗng, nhãn nằm trên hòn đá kết thúc đoạn ấy. Như vậy, nhãn của đoạn gà có thể nằm trên một con gà hoặc hòn đá phân cách; nhãn của đoạn lợn có thể nằm trên một con lợn hoặc hòn đá cuối cùng. Nhãn nằm trên đá biểu thị rằng máy ảnh được mô phỏng đã đến ô trống đầu tiên sau dãy con vật.

bộ điều khiển khởi đầu ở trạng thái khởi đầu và máy ảnh nằm ở vị trí đầu tiên của băng chuyền (có hòn đá mốc). Để mô phỏng một bước của chương trình hai băng, máy ảnh đi sang phải tìm nhãn của đoạn gà. Nếu nhãn nằm trên gà, bộ điều khiển chuyển sang trạng thái “tìm lợn, còn gà”; nếu nhãn nằm trên đá, nó chuyển sang trạng thái “tìm lợn, hết gà”. Máy ảnh tiếp tục sang phải để tìm nhãn của đoạn lợn; việc tìm kiếm trong đoạn lợn chỉ bắt đầu sau khi đã qua hòn đá phân cách. Khi tìm thấy nhãn của đoạn lợn, bộ điều khiển quyết định:

- Nếu trạng thái đang là "tìm lợn, còn gà" và dữ liệu hình ảnh là hòn đá, tức là số lượng gà nhiều hơn số lượng lợn, bộ điều khiển lập tức chuyển sang trạng thái từ chối và dừng hoạt động.
- Tương tự, nếu trạng thái đang là "tìm lợn, hết gà" và dữ liệu hình ảnh là con lợn, tức là số lượng lợn nhiều hơn số lượng gà, bộ điều khiển cũng lập tức chuyển sang trạng thái từ chối và dừng hoạt động.
- Ngược lại, nếu trạng thái đang là "tìm lợn, hết gà" và dữ liệu hình ảnh là hòn đá, tức là bộ điều khiển đã xem xét tất cả các con gà và lợn và số lượng hai bên là bằng nhau, bộ điều khiển sẽ chuyển sang trạng thái chấp nhận và dừng hoạt động.

Trường hợp còn lại là cả hai nhãn đều nằm trên con vật. Hệ thống đã tìm được một cặp gà và lợn, nên cần dịch hai đầu đọc mô phỏng sang phải một ô. Đầu tiên, bộ điều khiển sẽ chuyển sang trạng thái "quay về đầu" và di chuyển máy ảnh sang trái cho đến khi chạm tới hòn đá mốc. Tiếp theo, bộ điều khiển chuyển sang trạng thái "tìm gà có nhãn" và máy ảnh sẽ được di chuyển sang phải tới con gà được dán nhãn. Ở đây, bộ điều khiển sẽ tháo nhãn khỏi con gà, chuyển sang trạng thái "dán nhãn" và di chuyển sang phải để dán nhãn cho vị trí tiếp theo nếu đó là một con gà. Với quy trình tương tự, máy ảnh được di chuyển sang phải tới con lợn được dán nhãn, tháo nhãn khỏi con lợn, và dán nhãn cho vị trí bên phải nếu đó là một con lợn. Cuối cùng, bộ điều khiển chuyển sang trạng thái khởi đầu và máy ảnh được di chuyển sang trái cho đến khi chạm tới hòn đá mốc nhằm chuẩn bị cho bước mô phỏng tiếp theo. Quá trình này lặp lại liên tục cho đến khi hệ thống đạt tới trạng thái chấp nhận hoặc từ chối.

Mai nhận xét rằng mỗi bước của chương trình hai băng giờ được thay bằng một lượt mô phỏng gồm nhiều bước trên một băng. Phần thời gian tăng thêm chủ yếu đến từ việc máy ảnh phải đi lại giữa hai đoạn dữ liệu. Mặc dù chi phí rẻ hơn khi xây dựng hệ thống một băng là một đánh đổi xứng đáng cho việc tốn nhiều bước hơn, Mai vẫn muốn tìm một giải pháp tốt hơn nữa.

### Ghép cặp trực tiếp

Đúng lúc ấy, Thế Anh nảy ra một ý tưởng. Theo anh, Mai đã quá chú tâm vào việc mô phỏng hệ thống hai băng, trong khi chương trình trên một băng có thể đơn giản hơn nhiều. Chỉ cần giữ hòn đá mốc ở đầu, bỏ hai hòn đá còn lại. Việc tháo nhãn để chuyển sang con tiếp theo cũng không cần thiết: tại sao không giữ nguyên nhãn trên những con đã được ghép cặp?

Thế Anh đặt hòn đá mốc ở đầu băng, tiếp theo là tất cả các con gà rồi đến tất cả các con lợn. Phía sau dãy con vật là các ô trống. Ban đầu, chưa con nào có nhãn và máy ảnh nằm trên hòn đá mốc.

Khác với phần mô phỏng, nhãn bây giờ không còn biểu diễn vị trí của một máy ảnh khác. Nó đánh dấu con vật đã được ghép cặp và không cần xét lại. Trong mỗi lượt quét từ đầu dãy đến ô trống đầu tiên phía sau, hệ thống dán nhãn cho con gà chưa có nhãn đầu tiên gặp được và con lợn chưa có nhãn đầu tiên gặp được. Mỗi lượt chỉ dán thêm nhiều nhất một nhãn cho mỗi loài; các con đã có nhãn được bỏ qua.

Bộ điều khiển dùng trạng thái để ghi nhớ trong lượt hiện tại đã tìm được gà, lợn, cả hai hay chưa tìm được con nào. Khi đến ô trống cuối dãy, nếu không tìm được con nào chưa có nhãn, hệ thống chấp nhận. Nếu chỉ tìm được một trong hai loài, hệ thống từ chối. Nếu tìm được đủ một cặp, máy ảnh quay về hòn đá mốc, bộ điều khiển đặt lại trạng thái cho lượt mới rồi tiếp tục.

Mai đồng ý rằng cách này đơn giản hơn hẳn. Tuy vậy, tốc độ chưa cải thiện về bậc tăng: mỗi lượt vẫn phải đi dọc dãy dữ liệu rồi quay lại, mà chỉ xử lý thêm được một cặp. Khi số gà và số lợn bằng nhau, số lượt cần thực hiện vẫn tỉ lệ với số con vật. Thế nhưng, suy nghĩ đó đã cho Mai một ý tưởng: liệu có cách nào để dán nhãn cho nhiều con gà và lợn trong một lần di chuyển máy ảnh từ đầu tới cuối băng chuyền hay không? Ngay khi đặt ra câu hỏi này, Mai đã lập tức đưa ra một giải pháp mới.

## Giải pháp thứ ba

Mai cho rằng hoàn toàn có thể dán nhãn cho xấp xỉ một nửa số con mỗi loài trong một lượt di chuyển máy ảnh từ đầu tới cuối băng chuyền. Ý tưởng là so sánh các chữ số trong biểu diễn nhị phân của số gà và số lợn, bắt đầu từ chữ số ngoài cùng bên phải. Hai số bằng nhau khi và chỉ khi chúng có cùng số dư khi chia cho 2 và cùng thương nguyên. Vì vậy, ta có thể so sánh số dư trước, rồi lặp lại phép so sánh với hai thương nguyên vừa thu được. Nếu hai số ban đầu khác nhau, sẽ có một vòng mà hai số dư khác nhau.

Cách bố trí băng giống giải pháp ghép cặp: hòn đá mốc, dãy gà, dãy lợn, rồi đến các ô trống. Ban đầu, tất cả các con vật đều chưa có nhãn. Mỗi vòng lặp gồm hai lượt quét từ trái sang phải, và máy ảnh quay về hòn đá mốc giữa các lượt.

Lượt thứ nhất kiểm tra tính chẵn lẻ. Bộ điều khiển bắt đầu với thông tin “gà chẵn, lợn chẵn”. Mỗi khi gặp một con gà chưa có nhãn, nó đảo thông tin về gà từ chẵn sang lẻ hoặc ngược lại. Với lợn, nó làm tương tự. Những con đã có nhãn được bỏ qua. Đồng thời, bộ điều khiển ghi nhớ xem trong lượt này có gặp bất kì con vật nào chưa có nhãn hay không. Khi đến ô trống cuối dãy, nếu số gà và số lợn chưa có nhãn khác tính chẵn lẻ, hệ thống từ chối. Nếu không gặp con vật nào chưa có nhãn, hệ thống chấp nhận. Nếu hai số cùng tính chẵn lẻ và vẫn còn ít nhất một con chưa có nhãn, máy ảnh quay về đầu để thực hiện lượt thứ hai.

Lượt thứ hai giảm số con còn phải xét. Với từng loài, bộ điều khiển luân phiên giữa hai lựa chọn: “dán nhãn” và “bỏ qua”, bắt đầu bằng “dán nhãn”. Chỉ những con chưa có nhãn mới làm thay đổi lựa chọn này. Những con đã có nhãn từ các vòng trước được bỏ qua mà không làm thay đổi trạng thái luân phiên. Nói cách khác, trong dãy các con vật cùng loài chưa có nhãn ở đầu lượt, hệ thống dán nhãn cho con thứ nhất, bỏ qua con thứ hai, dán nhãn cho con thứ ba, rồi tiếp tục như vậy. Như vậy, nếu trước lượt quét một loài có $$k$$ con chưa có nhãn, hệ thống sẽ dán nhãn cho $$\lceil k/2\rceil$$ con và để lại $$\lfloor k/2\rfloor$$ con chưa có nhãn.

Mai nhận xét rằng mỗi vòng vẫn phải quét qua toàn bộ dãy dữ liệu. Tuy nhiên, số vòng đã giảm đáng kể, vì sau mỗi vòng chưa dừng, số con chưa có nhãn của mỗi loài giảm xuống còn khoảng một nửa.

Vô cùng mừng rỡ, Thế Anh nhờ Mai xây dựng và lập trình hệ thống theo như thiết kế. Nhưng Mai vẫn còn một thắc mắc: với hệ thống một băng này, liệu có chương trình nào hiệu quả hơn nữa hay không? Cô đoán rằng giải pháp này đã tối ưu, nhưng chưa tìm được cách chứng minh (và tất nhiên là Thế Anh cũng không thể). Các bạn đọc, nếu vẫn còn đọc đến đây, hãy thử giải đáp cho Thế Anh và Mai nhé!

## Lạm bàn

Nếu các bạn đã từng học qua lý thuyết tính toán, các bạn sẽ nhận ra bài viết đang mô tả (không đầy đủ) các máy Turing và ứng dụng trong việc kiểm tra một chuỗi nhị phân với các bit $$0$$ nối sau bởi các bit $$1$$ có cùng số lượng bit $$0$$ và $$1$$ hay không. Băng chuyền đóng vai trò băng nhớ; con vật, đá và tình trạng nhãn biểu diễn các ký hiệu thuộc một bảng chữ cái hữu hạn; máy ảnh cùng thiết bị dán, tháo nhãn đóng vai trò đầu đọc/ghi; còn bộ điều khiển có hữu hạn trạng thái. Dán hoặc tháo nhãn tương ứng với việc ghi một ký hiệu khác vào ô hiện tại. Giải pháp đầu tiên chỉ cần đọc, nên không sử dụng khả năng ghi của máy.

Gọi $$n$$ là độ dài chuỗi đầu vào, cũng là tổng số gà và lợn. Các cận thời gian dưới đây được hiểu theo trường hợp xấu nhất khi $$n$$ tăng. Giải pháp đầu tiên sử dụng một máy Turing hai băng (two-tape Turing machine), với độ phức tạp $$O(n)$$, tức là tuyến tính theo độ dài chuỗi đầu vào. Giải pháp mô phỏng là trường hợp đặc biệt của quá trình mô phỏng máy Turing hai băng bằng máy Turing một băng (one-tape Turing machine, hay đơn giản chỉ là Turing machine), với độ phức tạp $$O(n^2)$$ do cần mô phỏng $$O(n)$$ bước của máy Turing hai băng mà mỗi bước mô phỏng lại tốn $$O(n)$$ bước. Giải pháp ghép cặp trực tiếp là một thuật toán được thiết kế trực tiếp sử dụng máy Turing một băng cho bài toán trên, với độ phức tạp $$O(n^2)$$ do cần $$O(n)$$ bước mỗi lần lặp và cần $$O(n)$$ lần lặp vì mỗi lần lặp chỉ giảm được tối đa một cặp gà và lợn. Cuối cùng, giải pháp thứ ba sử dụng một máy Turing một băng với độ phức tạp $$O(n \log n)$$, tối ưu hơn so với giải pháp ghép cặp do mỗi lần lặp giảm được một nửa số lượng gà và lợn.

Câu hỏi cuối cùng là liệu có thể thiết kế một thuật toán với độ phức tạp tốt hơn $$O(n \log n)$$ trên máy Turing một băng hay không. Bật mí rằng Sipser đã chứng minh rằng không thể có thuật toán nào với độ phức tạp tốt hơn $$o(n \log n)$$ trên máy Turing một băng cho bài toán này (và tổng quát hóa cho nhiều bài toán khác, nhưng nằm ngoài phạm vi bài viết này). Do đó, giải pháp thứ ba là tối ưu nhất về mặt bậc tăng có thể đạt được trên máy Turing một băng.

## Tham khảo

[1] Introduction to the Theory of Computation, 3rd Edition, Michael Sipser.

[2] CS 579: Computational Complexity, Fall 2026, Michael Forbes.

## Công nhận

Bài viết được lên ý tưởng và bản nháp sơ khởi được viết bởi The-Anh Vu-Le. Bản nháp được chỉnh sửa bởi GPT-6 Astra nhằm đảm bảo tính chính xác. Bản nháp được chỉnh sửa lần cuối bởi The-Anh Vu-Le.
