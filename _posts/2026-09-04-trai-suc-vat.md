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
      - name: Sơ khởi
      - name: "Cải tiến"
  - name: Giải pháp thứ ba
---

> **Miễn trừ trách nhiệm**: Đây là một sản phẩm hư cấu. Tên, nhân vật, công ty, địa điểm, sự kiện đều hoặc là sản phẩm của trí tưởng tượng của tác giả hoặc được sử dụng với ý nghĩa hư cấu. Mọi tương đồng với những người, còn sống hay đã chết, hoặc với những sự kiện thực tế đều là trùng hợp ngẫu nhiên.

## Câu hỏi

Thế Anh là chủ một trại súc vật với một số lượng lớn các gia súc lẫn gia cầm. Trong số đó, loài gà và loài lợn chiếm số lượng áp đảo, và cũng đặc biệt quấn quít lấy nhau. Để giữ cho trang trại luôn ngập tràn niềm vui, Thế Anh cần phải liên tục đảm bảo số lượng gà và số lượng lợn là bằng nhau. Do đặc thù kinh doanh, Thế Anh luôn phải bán một số gà và lợn đi, cũng như mua về một số gà và lợn khác. Vì thế, để đảm bảo sự cân bằng mong muốn, hàng ngày Thế Anh đều phải trả lời câu hỏi: với một nhóm gà và lợn bất kì được cho, liệu số lượng gà và lợn trong nhóm có bằng nhau hay không. 

Dĩ nhiên, đây là một tác vụ quá đơn giản: không cần là thần đồng số học cũng có thể đếm số lượng gà và lợn trong nhóm và kiểm tra bằng nhau. Tuy nhiên, do nghỉ học từ nhỏ, Thế Anh không hề biết cách đếm số; bỗng dưng, bài toán trở nên khó khăn hơn nhiều. Thế Anh tìm đến Mai, một kỹ sư dữ liệu giàu kinh nghiệm, để thiết kế một hệ thống có thể giúp Thế Anh làm việc này. Tất nhiên, suy nghĩ đầu tiên của Mai là đưa cho Thế Anh một cái máy đếm số là xong việc. Nhưng có gì vui trong giải pháp đó cơ chứ? Mai suy nghĩ thêm một hồi và đưa ra một giải pháp bất ngờ.

## Giải pháp đầu tiên

Mai thiết kế một hệ thống gồm một bộ xử lý trung tâm và hai băng chuyền. 

Mỗi băng chuyền được chia thành các ô liên tiếp và được coi là có thể kéo dài tùy ý về bên phải. Mỗi ô chứa tối đa một con vật hoặc một vật đánh dấu. Các con vật và vật đánh dấu được đặt liền nhau, không có ô trống xen giữa; sau chúng là các ô trống. Mỗi băng chuyền có một chiếc máy ảnh đặt nhìn từ trên xuống, chỉ quan sát được ô ngay bên dưới. Máy ảnh có thể di chuyển dọc băng chuyền theo cả hai chiều nhằm ghi nhận hình ảnh của vật trong từng ô trên băng chuyền.

Bộ xử lý trung tâm có thể điều khiển các máy ảnh và ghi nhận dữ liệu hình ảnh từ chúng. Bên cạnh đó, bộ xử lý trung tâm có thể thay đổi giữa một số lượng hữu hạn các trạng thái khác nhau. Cụ thể, trong mỗi bước, bộ điều khiển căn cứ vào trạng thái hiện tại và dữ liệu hình ảnh từ mỗi máy ảnh để xác định trạng thái kế tiếp (có thể giống với trạng thái hiện tại), đồng thời ra lệnh cho từng máy ảnh dịch sang trái một ô, dịch sang phải một ô hoặc giữ nguyên vị trí.

Trong các trạng thái của bộ xử lý trung tâm, có hai trạng thái đặc biệt. Đầu tiên là trạng thái chấp nhận, nghĩa là bộ xử lý trung tâm sẽ thông báo rằng số lượng gà và lợn trên băng chuyền là bằng nhau. Trạng thái đặc biệt thứ hai là trạng thái từ chối, nghĩa là bộ xử lý trung tâm sẽ thông báo rằng số lượng gà và lợn trên băng chuyền là không bằng nhau. Khi bộ xử lý trung tâm chuyển sang một trong hai trạng thái đặc biệt này, nó sẽ dừng lại và không thực hiện thêm bất kì thao tác nào nữa.

Lập trình cụ thể của hệ thống này cho vấn đề của Thế Anh là như sau. Trên băng chuyền đầu tiên, Mai đặt tất cả các con gà trong nhóm cần kiểm tra. Trên băng chuyền thứ hai, Mai đặt tất cả các con lợn trong nhóm cần kiểm tra. Bộ xử lý trung tâm khởi đầu ở một trạng thái trung lập ban đầu và cả hai máy ảnh đều nằm ở vị trí đầu tiên của băng chuyền. Lần lượt, bộ xử lý trung tâm sẽ di chuyển hai máy ảnh đồng thời với nhau dọc theo hai băng chuyền và nhận dữ liệu hình ảnh từ chúng. Nếu bất kì lúc nào, bộ xử lý trung tâm nhận thấy một con gà trên băng chuyền đầu tiên nhưng không thấy một con lợn tương ứng trên băng chuyền thứ hai, nó sẽ chuyển sang trạng thái từ chối và dừng lại. Tương tự, nếu bộ xử lý trung tâm nhận thấy một con lợn trên băng chuyền thứ hai nhưng không thấy một con gà tương ứng trên băng chuyền đầu tiên, nó cũng sẽ chuyển sang trạng thái từ chối và dừng lại. Nếu bộ xử lý trung tâm di chuyển hết cả hai băng chuyền (di chuyển đến ô trống đầu tiên sau chuỗi con vật) mà không gặp phải bất kì trường hợp nào như vậy, nó sẽ chuyển sang trạng thái chấp nhận và dừng lại.

Nghe xong, Thế Anh tỏ ra vô cùng hài lòng và ngay lập tức cầu xin Mai xây dựng và lập trình hệ thống theo như thiết kế. Thế nhưng, Mai vẫn chưa cảm thấy hài lòng. Việc xây dựng hai băng chuyền và đặc biệt là hai máy ảnh là quá tốn kém, nên Mai muốn tìm một giải pháp kinh tế hơn. Lại sau một hồi suy nghĩ, Mai đưa ra một giải pháp mới.

## Giải pháp thứ hai

### Sơ khởi

Thay vì sử dụng hai băng chuyền và hai máy ảnh, Mai thiết kế một hệ thống chỉ có một băng chuyền duy nhất, và do đó chỉ cần một máy ảnh. Đổi lại, máy ảnh sẽ được trang bị thêm một thiết bị dán và tháo nhãn. Thiết bị này có thể dán nhãn lên và tháo nhãn của vật trên băng chuyền dưới sự điều khiển của bộ xử lý trung tâm. Như vậy, trong một bước, bộ xử lý trung tâm có thể thực hiện thêm thao tác dán hoặc tháo nhãn lên vật trên băng chuyền. Ý tưởng chính ở đây là Mai hoàn toàn có thể mô phỏng hệ thống hai băng chuyền bằng hệ thống một băng chuyền mới này.

Trên băng chuyền duy nhất, Mai đặt lần lượt một hòn đá mốc đánh dấu ở đầu, tất cả các con gà trong nhóm cần kiểm tra, một hòn đá khác, tất cả các con lợn trong nhóm cần kiểm tra, và một hòn đá cuối cùng. Lưu ý hòn đá mốc ở đầu sẽ khác biệt với các hòn đá khác nhằm phân biệt vị trí đầu tiên của băng chuyền. Tiếp đó, Mai dán nhãn lên con gà đầu tiên và con lợn đầu tiên. Nói đơn giản, hai băng chuyền trong giải pháp đầu tiên được mô phỏng bằng hai đoạn trên băng chuyền duy nhất, với các hòn đá làm ranh giới phân tách và nhãn dán mô phỏng vị trí máy ảnh trên hai băng chuyền.

Bộ xử lý trung tâm khởi đầu ở trạng thái trung lập ban đầu và máy ảnh nằm ở vị trí đầu tiên của băng chuyền (có hòn đá mốc). Để mô phỏng một bước của hệ thống hai băng chuyền, bộ xử lý sẽ chuyển trạng thái sang "tìm gà" và di chuyển máy ảnh đến vị trí con gà có dán nhãn đầu tiên hoặc hòn đá. Tại đây, bộ xử lý sẽ ghi nhận hình ảnh để chuyển qua trạng thái "tồn tại gà" hoặc "hết gà" tương ứng. Kế tiếp, bộ xử lý sẽ chuyển sang trạng thái "tìm lợn" và di chuyển máy ảnh sang phải, vượt qua hòn đá phân cách ở giữa để tìm đến vị trí con lợn đang được dán nhãn hoặc hòn đá đuôi. Tại đây, bộ xử lý lại sẽ ghi nhận dữ liệu hình ảnh và kết hợp với trạng thái hiện tại để quyết định bước tiếp theo:

- Nếu trạng thái đang là "tồn tại gà" và dữ liệu hình ảnh là hòn đá, tức là số lượng gà nhiều hơn số lượng lợn, bộ xử lý lập tức chuyển sang trạng thái từ chối và dừng hoạt động.
- Tương tự, nếu trạng thái đang là "hết gà" và dữ liệu hình ảnh là con lợn, tức là số lượng lợn nhiều hơn số lượng gà, bộ xử lý cũng lập tức chuyển sang trạng thái từ chối và dừng hoạt động.
- Ngược lại, nếu trạng thái đang là "hết gà" và dữ liệu hình ảnh là hòn đá, tức là bộ xử lý đã xem xét tất cả các con gà và lợn và số lượng hai bên là bằng nhau, bộ xử lý sẽ chuyển sang trạng thái chấp nhận và dừng hoạt động.

Trường hợp còn lại là khi trạng thái đang là "tồn tại gà" và dữ liệu hình ảnh là con lợn, tức ta tìm được một cặp gà và lợn, bộ xử lý sẽ chuẩn bị cho việc mô phỏng bước tiếp theo. Đầu tiên, bộ xử lý sẽ chuyển sang trạng thái "quay về đầu" và di chuyển máy ảnh sang trái cho đến khi chạm tới hòn đá đầu tiên. Tiếp theo, bộ xử lý chuyển sang trạng thái "tìm gà có nhãn" và máy ảnh sẽ được di chuyển sang phải tới con gà được dán nhãn. Ở đây, bộ xử lý sẽ tháo nhãn khỏi con gà, chuyển sang trạng thái "dán nhãn" và di chuyển sang phải để dán nhãn cho vị trí tiếp theo nếu đó là một con gà. Với quy trình tương tự, máy ảnh được di chuyển sang phải tới con lợn được dán nhãn, tháo nhãn khỏi con lợn, và dán nhãn cho vị trí bên phải nếu đó là một con lợn.

Quá trình này lặp lại liên tục cho đến khi hệ thống đạt tới trạng thái dừng.

Mai nhận xét rằng số bước phải mô phỏng bằng với số bước của hệ thống hai băng chuyền, nhưng mỗi bước mô phỏng lại tốn nhiều bước hơn do việc di chuyển máy ảnh qua lại trên băng chuyền. Mặc dù chi phí rẻ hơn khi xây dựng hệ thống một băng chuyền là một đánh đổi xứng đáng cho việc tốn nhiều bước hơn, Mai vẫn muốn tìm một giải pháp tốt hơn nữa.

### "Cải tiến"

Ngay lúc này, một ý tưởng lóe lên trong đầu Thế Anh, và anh ngay lập tức nói với Mai. Anh cho rằng Mai đã quá chú tâm tới việc mô phỏng hệ thống hai băng chuyền, trong khi thực tế, lập trình của hệ thống một băng chuyền có thể được đơn giản hóa. Trước nhất, các hòn đá là hoàn toàn không cần thiết trừ hòn đá khởi đầu và có thể bị loại bỏ. Thứ hai, việc gỡ bỏ nhãn để chuyển qua vị trí tiếp theo là cũng không cần thiết, và thậm chí cũng không cần thao tác gỡ nhãn.

Lập trình của hệ thống một băng chuyền được đơn giản hóa như sau. Thế Anh đặt tất cả các con gà trong nhóm cần kiểm tra lên băng chuyền, tiếp theo là tất cả các con lợn trong nhóm cần kiểm tra. Bộ xử lý trung tâm khởi đầu ở trạng thái trung lập ban đầu và máy ảnh nằm ở vị trí đầu tiên của băng chuyền. Tiếp đó, bộ xử lý sẽ di chuyển máy ảnh từ đầu tới cuối băng chuyền và dán nhãn cho một con gà không nhãn đầu tiên gặp phải và một con lợn không nhãn đầu tiên gặp phải. Nếu không còn con gà hoặc con lợn nào chưa được dán nhãn, bộ xử lý sẽ chuyển sang trạng thái chấp nhận và dừng lại. Mặt khác, nếu bộ xử lý di chuyển hết băng chuyền mà chỉ tìm được một con gà hoặc một con lợn chưa được dán nhãn, bộ xử lý sẽ chuyển sang trạng thái từ chối và dừng lại. Trường hợp còn lại là khi bộ xử lý tìm được một con gà và một con lợn chưa được dán nhãn, nó sẽ quay về đầu băng chuyền và lặp lại quá trình trên.

Mai nhận xét rằng quả thật đây là một giải pháp đơn giản hơn so với việc mô phỏng hệ thống hai băng chuyền, nhưng số lượng bước cần thực hiện vẫn ở mức ngang với giải pháp mô phỏng cũ. Điều này là do bộ xử lý trung tâm vẫn phải di chuyển máy ảnh qua lại trên cả băng chuyền mỗi lần lặp; và do mỗi lần lặp cũng chỉ dán nhãn được tối đa một cặp gà và lợn, ta vẫn cần số lần lặp bằng với số lượng gà hoặc lợn trong nhóm. Thế Anh và Mai đều đồng ý rằng giải pháp này vẫn chưa thực sự tối ưu. Thế nhưng, suy nghĩ đó đã cho Mai một ý tưởng: liệu có cách nào để dán nhãn cho nhiều con gà và lợn trong một lần di chuyển máy ảnh từ đầu tới cuối băng chuyền hay không? Ngay khi đặt ra câu hỏi này, Mai đã lập tức đưa ra một giải pháp mới.

## Giải pháp thứ ba

Mai cho rằng hoàn toàn có thể dán nhãn cho một nửa số gà và một nửa số lợn trong một lần di chuyển máy ảnh từ đầu tới cuối băng chuyền. Ý tưởng ở đây là, để kiểm tra số lượng gà và lợn có bằng nhau hay không, ta có thể kiểm tra từng bit của số lượng. Cụ thể, nếu số lượng gà và lợn là bằng nhau, thì mỗi khi chia số lượng gà và lợn cho 2, ta sẽ nhận được cùng một phần dư. Ngược lại, nếu số lượng gà và lợn là khác nhau, thì sẽ có ít nhất một lần chia mà phần dư của số lượng gà và lợn là khác nhau.

Lập trình của hệ thống một băng chuyền theo ý tưởng này được thiết kế như sau. Giống như Thế Anh, Mai vẫn sẽ đặt tất cả các con gà trong nhóm cần kiểm tra lên băng chuyền, tiếp theo là tất cả các con lợn trong nhóm cần kiểm tra. Bộ xử lý trung tâm khởi đầu ở trạng thái trung lập ban đầu và máy ảnh nằm ở vị trí đầu tiên của băng chuyền. Tiếp đó, bộ xử lý sẽ di chuyển máy ảnh từ đầu tới cuối băng chuyền và cứ cách một con gà chưa được dán nhãn, nó sẽ dán nhãn cho con gà đó. Tương tự, cứ cách một con lợn chưa được dán nhãn, nó sẽ dán nhãn cho con lợn đó. Khi máy ảnh di chuyển hết băng chuyền, bộ xử lý sẽ điều khiển máy ảnh quay về đầu băng chuyền và di chuyển máy ảnh từ đầu tới cuối băng chuyền một lần nữa. Lần này, bộ xử lý sẽ kiểm tra xem số lượng gà và lợn còn lại chưa được dán nhãn có cùng tính chẵn lẻ hay không. Điều này có thể được thực hiện sử dụng các trạng thái của bộ xử lý trung tâm. Ban đầu, trạng thái của bộ xử lý trung tâm sẽ là "chẵn gà, chẵn lợn". Cứ mỗi lần ghi nhận được một con gà chưa được dán nhãn, bộ xử lý sẽ chuyển từ "chẵn gà" sang "lẻ gà" hoặc ngược lại. Tương tự, cứ mỗi lần ghi nhận được một con lợn chưa được dán nhãn, bộ xử lý sẽ chuyển từ "chẵn lợn" sang "lẻ lợn" hoặc ngược lại. Khi máy ảnh di chuyển hết băng chuyền, nếu trạng thái của bộ xử lý trung tâm là "cchẵn gà, lẻ lợn" hoặc "lẻ gà, chẵn lợn", bộ xử lý sẽ chuyển sang trạng thái từ chối và dừng lại. Ngược lại, nếu trạng thái của bộ xử lý trung tâm là "chẵn gà, chẵn lợn" hoặc "lẻ gà, lẻ lợn", bộ xử lý sẽ quay về đầu băng chuyền và lặp lại quá trình trên (bao gồm cả việc dán nhãn cách một con). Quá trình này sẽ được lặp lại cho đến khi không còn con gà hoặc con lợn nào chưa được dán nhãn; lúc này, bộ xử lý sẽ chuyển sang trạng thái chấp nhận và dừng lại.

Mai nhận xét rằng số bước cần thực hiện trong giải pháp này đã giảm đáng kể so với các giải pháp trước. Cụ thể, tuy số bước trong một lần lặp tương đồng với giải pháp trước, số lần lặp lại đã giảm đi đáng kể vì mỗi lần lặp, số lượng gà và lợn chưa được dán nhãn sẽ giảm đi một nửa.

Vô cùng mừng rỡ, Thế Anh nhờ Mai xây dựng và lập trình hệ thống theo như thiết kế. Thế nhưng, câu hỏi đặt ra là liệu có thể giảm số bước cần thực hiện xuống thấp hơn nữa hay không. Mai đoán rằng đây là giải pháp tối ưu nhất có thể đạt được với hệ thống một băng chuyền rồi, nhưng chưa thể khẳng định chắc chắn. Tuy thế, Mai không thể chứng minh được điều này (và tất nhiên Thế Anh cũng không thể). Các bạn đọc, nếu vẫn còn ở lại đến đây, hãy giải đáp giúp Thế Anh và Mai nhé!

## Lạm bàn

Nếu các bạn đã từng học qua lý thuyết tính toán, các bạn sẽ nhận ra bài viết đang mô tả (không đầy đủ) các máy Turing và ứng dụng trong việc kiểm tra một chuỗi nhị phân với các bit $$0$$ nối sau bởi các bit $$1$$ có cùng số lượng bit $$0$$ và $$1$$ hay không. Giải pháp đầu tiên sử dụng một máy Turing hai tệp, với độ phức tạp tuyến tính với độ dài chuỗi đầu vào (số bước của máy là $$O(n)$$ với $$n$$ là độ dài chuỗi đầu vào). Phiên bản sơ khởi của giải pháp thứ hai là trường hợp đặc biệt của quá trình mô phỏng máy Turing hai tệp bằng máy Turing một tệp, với độ phức tạp $$O(n^2)$$ do cần mô phỏng $$O(n)$$ bước của máy Turing hai tệp, mỗi bước mô phỏng lại tốn $$O(n)$$ bước. Phiên bản "cải tiến" của giải pháp thứ hai là một thuật toán được thiết kế trực tiếp sử dụng máy Turing một tệp cho bài toán trên, với độ phức tạp $$O(n^2)$$ như đã mô tả (cần $$O(n)$$ bước mỗi lần lặp và cần $$O(n)$$ lần lặp vì mỗi lần lặp chỉ giảm được tối đa một cặp gà và lợn). Cuối cùng, giải pháp thứ ba sử dụng một máy Turing một tệp với độ phức tạp $$O(n \log n)$$ do mỗi lần lặp giảm được một nửa số lượng gà và lợn. 

Câu hỏi cuối cùng là liệu có thể thiết kế một thuật toán với độ phức tạp tốt hơn $$O(n \log n)$$ trên máy Turing một tệp hay không. Bật mí rằng Sipser đã chứng minh rằng không thể có thuật toán nào với độ phức tạp tốt hơn $$o(n \log n)$$ trên máy Turing một tệp cho bài toán này. Do đó, giải pháp thứ ba là tối ưu nhất có thể đạt được trên máy Turing một tệp.

## Tham khảo

[1] Introduction to the Theory of Computation, 3rd Edition, Michael Sipser.

[2] CS 579: Computational Complexity, Fall 2026, Michael Forbes.
